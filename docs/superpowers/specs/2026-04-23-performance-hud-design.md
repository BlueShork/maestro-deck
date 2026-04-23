# Performance HUD — Design

**Date:** 2026-04-23
**Status:** Design approved, pending implementation plan
**Scope:** v0.2 feature, Android-only (aligned with v0.1 device support)

## Goal

Surface near real-time performance metrics of the Android app currently in foreground on the connected device, displayed in a collapsible side panel next to the Run Console. Users opt-in via a settings toggle. When the panel is closed, no polling occurs — zero overhead for users who don't need it.

The feature works independently of the Maestro runner — metrics are visible whether a test is running or not. This lets QA engineers correlate app behavior with manual inspection, not only automated runs.

## Non-goals (v1)

- No disk persistence — session-scoped RAM buffer only.
- No CSV/JSON export.
- No correlation with individual Maestro flow steps.
- No alerting thresholds.
- No iOS support.
- No historical comparison across runs.

## Target app resolution

We monitor the app currently in foreground on the device, auto-detected. No user dropdown, no flow-based inference.

- **Detection command:** `adb shell dumpsys window | grep mCurrentFocus`
- **Frequency:** every 3 seconds (cheap enough, but not per-tick).
- **PID resolution:** `adb shell pidof <pkg>` once per target, cached until foreground change.
- **UID resolution:** `adb shell dumpsys package <pkg> | grep userId=` once per target, cached. Used for network stats filtering.
- **On change:** emit `metrics:target_changed`, reset sparklines, show a toast. The user sees continuous monitoring of whatever is on screen, including during Maestro's `launchApp` commands.

## Metrics

### Collected continuously (when panel open)

| Metric | Source | Poll frequency | Rationale |
|---|---|---|---|
| CPU % | `/proc/<pid>/stat` (utime + stime delta over wall-clock delta × cores) | 1s | Fast, no `dumpsys` cost |
| RAM (MB) | `/proc/<pid>/status` (VmRSS) | 1s | PSS would be more accurate but requires `dumpsys meminfo` (~200ms). VmRSS is close enough for real-time display |
| Network I/O (KB/s up/down) | `adb shell cat /proc/net/xt_qtaguid/stats` filtered by app UID | 2s | Per-app byte counts. UID resolved once via `dumpsys package <pkg> \| grep userId`. On Android 12+ where `xt_qtaguid` is unavailable, fall back to `adb shell dumpsys netstats detail \| grep <uid>` (slower — hence 2s cadence, not 1s) |
| FPS | `dumpsys gfxinfo <pkg> framestats` | 5s | More expensive (~50-100ms); 5s is enough for "is the app smooth" |
| Jank % | Same as FPS | 5s | Frames rendered > 16ms / total frames in window |

### Batching

Per tick (1s), batch `/proc/<pid>/stat` and `/proc/<pid>/status` into a single `adb shell` invocation with `;` separators (we want all reads attempted even if one fails). This halves the ADB round-trips for the 1Hz path.

Example batched command:
```
adb shell "cat /proc/<pid>/stat; echo ---; cat /proc/<pid>/status"
```

Net I/O (2s cadence) and `gfxinfo` (5s cadence) run on their own timers since they're on different frequencies and use different underlying commands.

### Dropped from v1

- **Battery drain (mA):** irrelevant on USB (device plugged).
- **GPU %:** unreliable across Android versions/vendors.
- **Thread count:** niche, low signal-to-noise for QA users.

## Architecture

### Backend (Rust)

New module `src-tauri/src/metrics/`:

```
metrics/
  mod.rs         // Tokio task lifecycle + state
  collector.rs   // ADB command building + /proc and dumpsys parsing
  foreground.rs  // Foreground app + PID detection
```

**Lifecycle** — single-flight pattern identical to `src-tauri/src/runner/mod.rs`:

- A `once_cell::sync::Lazy<AsyncMutex<Option<oneshot::Sender<()>>>>` holds the kill handle for the active polling task.
- `start_metrics()` spawns the task if none running, returns `AlreadyRunning` otherwise.
- `stop_metrics()` sends on the oneshot and drops the handle; task exits cleanly on next tick.
- On device disconnect: the task detects ADB failure, exits, emits `metrics:stopped` with the reason.

**IPC commands** (added to `src-tauri/src/ipc/commands.rs`):

- `start_metrics() -> Result<(), AppError>`
- `stop_metrics() -> Result<(), AppError>`

**Events emitted:**

- `metrics:sample` — `{ package: String, cpu_pct: f32, mem_mb: f32, fps: Option<f32>, jank_pct: Option<f32>, net_rx_kbps: f32, net_tx_kbps: f32, ts: u64 }`
  - `fps` and `jank_pct` are `Option` because they're only refreshed every 5s; intermediate samples carry `None` and the frontend keeps the last known value visible.
- `metrics:target_changed` — `{ from: Option<String>, to: String }`
- `metrics:stopped` — `{ reason: "user" | "device_disconnected" | "error", message: Option<String> }`

### Frontend (React)

**Store** — `src/stores/metricsStore.ts`:

```ts
interface Sample {
  ts: number;
  cpuPct: number;
  memMb: number;
  fps: number | null;
  jankPct: number | null;
  netRxKbps: number;
  netTxKbps: number;
}

interface MetricsState {
  enabled: boolean;        // settings toggle, persisted
  panelOpen: boolean;      // ephemeral UI state, default false
  currentPackage: string | null;
  samples: Sample[];       // ring buffer, max 60 (60s @ 1Hz)
  setEnabled: (v: boolean) => void;
  togglePanel: () => void;
  appendSample: (s: Sample) => void;
  onTargetChanged: (pkg: string) => void;
  reset: () => void;
}
```

The `enabled` flag lives in `settingsStore` for persistence; `metricsStore` reads it via selector. Persistence path matches existing settings (already handled by `src/stores/settingsStore.ts`).

**Component** — `src/components/MetricsPanel.tsx`:

- Fixed width ~280px, sits to the right of the `RunConsole` in the bottom bar.
- Both siblings share the same `h-48` height already used by `RunConsole`.
- Header: current package name (truncated) + close button (X icon).
- Body: vertical stack of 5 metric cards:
  - CPU (%), RAM (MB), FPS, Jank (%), Net (↓/↑ KB/s)
  - Each card: current value in large text + 60s inline SVG sparkline + min/max overlay.
- Empty state when no device: "Connect a device to monitor performance."
- Target-change banner: small inline notice when package flips, auto-dismiss after 3s.

**Toggle controls:**

- **Settings dialog** (`src/components/SettingsDialog.tsx`): new checkbox "Enable performance monitoring" — default `false`. When turned off while panel is open: panel closes, polling stops.
- **Run Console toolbar**: new icon button (`Activity` from lucide-react) next to "Clear". Only rendered when settings toggle is ON. Click → toggles `panelOpen`.

### Layout change

Current bottom bar in `src/App.tsx` (or equivalent):

```
<section className="flex h-48 ...">
  <RunConsole />
</section>
```

Becomes:

```
<section className="flex h-48 ...">
  <RunConsole />              {/* flex-1 */}
  {panelOpen && <MetricsPanel />}  {/* w-[280px] */}
</section>
```

## Lifecycle summary

| State | Polling? | Panel visible? | Button visible? |
|---|---|---|---|
| Settings OFF | no | no | no |
| Settings ON, panel closed | no | no | yes |
| Settings ON, panel open, device connected | yes | yes | yes |
| Settings ON, panel open, device disconnected | no | yes (empty state) | yes |

The frontend drives polling lifecycle:
- On `togglePanel` open → call `start_metrics()` IPC.
- On `togglePanel` close, settings disable, or component unmount → call `stop_metrics()`.
- On `device_disconnected` event (existing in `deviceStore`) → panel keeps open but shows empty state; polling already stopped backend-side.

## Error handling

- **ADB command failure mid-session:** the collector logs the error, skips that tick, and continues. Three consecutive failures → emit `metrics:stopped { reason: "error" }` and the frontend shows an error state in the panel with a retry button.
- **No foreground app detectable** (rare — lock screen, launcher itself): panel shows "Waiting for foreground app…" and keeps probing every 3s.
- **Target process dies** (`pidof` returns nothing): treat as foreground change, re-detect.

## Testing strategy

Aligned with the existing pattern in `src-tauri/src/runner/mod.rs`:

- **Unit tests** for pure parsing logic in `collector.rs`:
  - `/proc/<pid>/stat` parsing → (utime, stime, starttime)
  - `/proc/<pid>/status` parsing → VmRSS
  - `xt_qtaguid/stats` parsing → rx/tx bytes for a given UID
  - `dumpsys netstats detail` parsing → rx/tx bytes for a given UID (fallback path)
  - `dumpsys package` parsing → `userId`
  - `dumpsys gfxinfo framestats` parsing → (fps, jank_pct)
  - `dumpsys window` parsing → foreground package
- **Error paths:** malformed inputs, missing fields, negative deltas (clock skew).
- **No integration tests** for ADB-touching paths in v1 — same posture as the rest of the device layer, per `docs/ARCHITECTURE.md § Testing strategy`.

## Host app performance constraints (non-negotiable)

Maestro Deck's v0.1 KPIs from `docs/PLAN.md § 6` must hold with this feature shipped:

| Existing KPI | Target | This feature must not breach |
|---|---|---|
| Cold start | < 1s | Lazy-load `MetricsPanel` component; no backend task at boot |
| RAM idle (feature OFF) | < 100 MB | Zero additional allocations: module not instantiated until `start_metrics()` |
| RAM idle (feature ON, panel closed) | < 100 MB | Same — settings flag alone must not spawn anything |
| RAM streaming (panel open) | < 200 MB | Ring buffer is 2.4 KB; sparkline SVG nodes bounded to 60 points × 5 cards |
| FPS streaming | 60 stable | Sparkline re-renders at 1 Hz, off the scrcpy frame loop; use `React.memo` + separate `requestAnimationFrame` budget |
| Input latency | < 50 ms | IPC metrics traffic is 1 small event/s — negligible, but confirm no channel contention with input events under stress |

**Enforcement rules:**

- **No polling when panel closed, period.** This is the biggest lever. Verified by the lifecycle table above.
- **No background work at all when settings flag is OFF.** The metrics module must not register listeners, allocate buffers, or import heavy deps at app start. Frontend: dynamic import of `MetricsPanel`. Backend: the Tokio task is only spawned on `start_metrics()`.
- **Batched `adb shell` calls.** One invocation per tick for /proc reads (the expensive part is the ADB round-trip, not the CPU work).
- **Sparkline rendering isolation.** Sparklines render as inline SVG with fixed point count, keyed by timestamp so React reconciles in O(n). No canvas. No chart lib (e.g., no Recharts/D3 pulled in for this) — hand-rolled `<polyline>` to keep bundle impact near zero.
- **Bundle size budget for this feature: < 10 KB gzipped frontend, no new Rust crates beyond what's already pulled (tokio, once_cell, serde, quick-xml/regex for parsing).**

## Polling performance budget (when active)

- Active polling CPU on host: target < 2% (revised down from initial 5% estimate given the constraints above). Dominated by ADB round-trip, not parsing.
- Zero CPU when panel closed or feature disabled.
- Memory overhead: 60 samples × ~40 bytes = 2.4 KB ring buffer per session. Negligible.

## CI enforcement (deferred but noted)

Per `docs/ARCHITECTURE.md § Performance targets`, KPIs should eventually be enforced in CI. When that harness lands, add two benchmarks for this feature:

1. Cold start with settings flag ON, panel closed → must match baseline within noise margin.
2. Streaming FPS with panel open and polling active → must stay ≥ 60.

## Open questions (deferred)

- Should `dumpsys gfxinfo` reset the frame stats after each read? Resetting gives per-window jank; not resetting gives cumulative. We'll reset on read for more actionable data, but this may warrant a toggle later.
- Do we want a "peak" indicator (highest CPU/RAM seen this session) surfaced in the header? Low effort, potentially deferred to v1.1 based on user feedback.
