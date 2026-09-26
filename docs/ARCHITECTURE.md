# Architecture

This document is a contributor-facing summary of how Maestro Deck is organized.
The full project plan with timelines and KPIs lives in `PLAN.md`.

## Process model

Maestro Deck is a single-window Tauri 2 desktop app:

- A native **Rust backend** owns ADB, scrcpy orchestration, video decoding, UI
  hierarchy parsing, selector ranking, YAML generation, and the Maestro
  runner subprocess.
- A **React 18 + TypeScript** frontend (rendered inside Tauri's webview) owns
  the visual UI: device view canvas, inspector panel, Monaco-based YAML
  editor, run console.
- They communicate over Tauri's IPC channel using `invoke` for request/reply
  and `emit`/`listen` for streamed events (frames, runner logs).

```
+-----------------------------------------+
|  Frontend (React, in Tauri webview)     |
|  - DeviceSelector                       |
|  - DeviceView (<canvas>)                |
|  - InspectorPanel                       |
|  - FlowEditor (Monaco)                  |
|  - RunConsole                           |
|  Stores: device / stream / inspector /  |
|          flow / run / settings (Zustand)|
+----------------+------------------------+
                 |
                 |  invoke(...)  /  listen(event)
                 v
+-----------------------------------------+
|  Backend (Rust)                         |
|  - device::adb        (ADB wrapper)     |
|  - scrcpy             (server lifecycle)|
|  - video              (H.264 decode)    |
|  - input              (touch/key proto) |
|  - hierarchy          (UIAutomator XML) |
|  - selector           (R-tree, ranking) |
|  - yaml               (Maestro flow gen)|
|  - runner             (maestro test)    |
|  - ipc::commands      (Tauri handlers)  |
+----------------+------------------------+
                 |
                 v  USB / TCP-tunnel
            Android device
```

## Key flows

**Connect a device.** `list_devices` shells out to `adb devices -l`, parses
the output, and returns enriched entries (model, Android version, screen
size). The frontend lets the user pick one and calls `connect_device`.

**Stream frames.** `connect_device` pushes `scrcpy-server.jar` to
`/data/local/tmp/`, opens a TCP forward via `adb forward`, and starts the
server with `app_process`. The backend reads the H.264 Annex-B stream,
splits it into NAL units, decodes them, and `emit("frame", ...)` to the
frontend, which `putImageData`s into a `<canvas>` inside a
`requestAnimationFrame`.

**Inspect an element.** Pressing `I` calls `enter_inspect_mode`. The backend
runs `uiautomator dump`, pulls the XML, parses it with `quick-xml`, and
returns a tree. It also builds an `rstar` R-tree keyed on each node's
`bounds`. When the user clicks the canvas, the frontend translates pixel
coords back to device coords and calls `query_element(x, y)`. The backend
returns the smallest-area node whose bounds contain the point — i.e. the
deepest matching leaf.

**Generate a command.** Once a node is selected, the backend ranks selector
candidates: `resource-id` > `text` > `content-desc` > `point` fallback. The
frontend lists them; clicking one calls `generate_command(action)` which
returns a YAML fragment that the editor inserts at the cursor.

**Run a flow.** `run_flow(file_path)` spawns `maestro test <file>` via
`tokio::process`, captures stdout/stderr line-by-line, streams them to the
frontend as `runner:stdout` / `runner:stderr` events, and emits a
`runner:exit` when the child terminates.

**Usage statistics.** Opt-in only. `TelemetryConsentDialog` asks once on
first launch (before the guided tour) and stores the answer in
`telemetryStore`. `src/lib/telemetry.ts` is the only module that sends
anything: `track()` is a no-op unless consent is `"granted"` and the build is
not a dev build, and it batches events to PostHog's EU capture API over
`fetch` — no SDK, no autocapture, no remotely loaded script. Events carry a
random install ID and never include flow contents, paths, device identifiers
or user input; the `TelemetryEvents` type is the full list of what can be sent.

## IPC contract

Names and signatures are intentionally frozen — the frontend and backend
are versioned together, but renaming a command counts as a breaking change.
See `src-tauri/src/ipc/commands.rs` for the source of truth and
`src/lib/ipc.ts` for the TypeScript wrapper.

## Performance targets

The plan defines KPIs (cold start, RAM, FPS, latency, hierarchy dump time)
that should eventually be enforced by CI benchmarks. See `PLAN.md §6`.

## Testing strategy

- **Pure logic** (parsers, encoders, selector ranking, YAML generation) is
  fully unit-tested in `src-tauri/src/<module>/mod.rs#tests` and against
  fixtures in `src-tauri/tests/fixtures/`.
- **Device-touching code** (real ADB calls, scrcpy stream, input forwarding,
  Maestro runner) currently has only error-path coverage. End-to-end tests
  require a connected device and are tracked under integration tests we'll
  add in CI once a device-runner is provisioned.
