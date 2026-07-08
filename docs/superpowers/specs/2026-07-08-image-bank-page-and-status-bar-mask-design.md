# Image Bank page + status-bar masking — design

Date: 2026-07-08
Status: Approved (design)

## Context

The screenshot visual-regression "bank" already exists (shipped in v0.7.0,
`feat(bank-img)`). Baselines live on disk at
`<workspace>/maestro/bank/<device_key>/<name>.png`. Today the only UI is the
post-run modal `ScreenshotReview`, which pops after a flow run to let the user
keep or replace a changed baseline. There is no way to *browse* or *manage* the
stored bank, and there is no way to exclude volatile screen regions (the
status-bar clock / notch / carrier band) from comparison, which produces false
positives.

This spec covers two independent features:

1. A dedicated full-page **Image Bank** tab to browse and manage baselines.
2. An **ignore-status-bar** option that excludes the top band of each screenshot
   from the diff.

Relevant existing code:
- Rust bank: `src-tauri/src/bank/{mod,compare,diff,flow,ipc}.rs`
- IPC registration: `src-tauri/src/lib.rs`
- Frontend: `src/components/ScreenshotReview.tsx`,
  `src/stores/{reviewStore,visualRegressionStore}.ts`,
  `src/types/visualRegression.ts`, `src/lib/ipc.ts`
- Routing: `src/App.tsx` (`/` → MainView, `/settings/:section` → SettingsPage)
- Toolbar entry points: `src/components/Toolbar.tsx`

---

## Feature 1 — Image Bank page

**Scope:** browse + manage (delete). Explicitly NOT in scope: reviewing the last
run's diffs here — that stays in the existing `ScreenshotReview` modal.

### Navigation
- New Toolbar icon button (`Images` from lucide-react) → `navigate("/image-bank")`,
  placed next to the Settings gear.
- New route `/image-bank` → `<ImageBankPage />` in `App.tsx`, mirroring the
  `/settings` pattern: full page, with MainView kept mounted-but-hidden so
  returning is instant.

### Backend (Rust, `src-tauri/src/bank/ipc.rs` + registration in `lib.rs`)
Four new `#[tauri::command]`s:

- `list_bank(workspace: String) -> Vec<BankGroup>`
  - `BankGroup { device_key: String, images: Vec<BankImage> }`
  - `BankImage { name: String, width: u32, height: u32, size_bytes: u64, modified_ms: u64 }`
  - Metadata only — no pixels — so the listing stays cheap. Reads
    `<workspace>/maestro/bank/*/*.png`; width/height decoded via the `image`
    crate (dimensions only). Returns empty vec if the bank dir is absent.
- `load_bank_image(workspace, device_key, name) -> String`
  - Returns a `data:image/png;base64,...` URI for one image, loaded lazily by the
    gallery/lightbox (same convention as the existing review UI).
- `delete_bank_image(workspace, device_key, name) -> ()`
  - Deletes one baseline PNG. Path is validated to stay within
    `<workspace>/maestro/bank/<device_key>/` (reject `..`/separators in
    `device_key`/`name`).
- `delete_bank_device(workspace, device_key) -> ()`
  - Deletes an entire `<device_key>` directory (same path validation).

### Frontend (`src/components/ImageBankPage.tsx`)
- Header with title + back button (reuse the SettingsPage chrome pattern).
- Device-group selector (list/tabs of `device_key`s from `list_bank`).
- Grid gallery of the selected group's screenshots: lazy-loaded thumbnail
  (via `load_bank_image`), with name + `WxH` caption.
- Click a thumbnail → full-screen lightbox with zoom (view large).
- Delete affordance per image and per group, each behind a confirm
  (reuse existing confirm/dialog primitives).
- Empty states: "Open a folder to use the image bank" when no workspace;
  "No baselines yet" when the bank is empty.
- IPC surface added to `src/lib/ipc.ts`: `listBank`, `loadBankImage`,
  `deleteBankImage`, `deleteBankDevice`. Types added to
  `src/types/visualRegression.ts` (`BankGroup`, `BankImage`).

State: the page holds local React state (selected group, loaded images,
pending deletes); no global store needed for v1.

---

## Feature 2 — Ignore status bar during comparison

**Principle:** do not alter the capture (Maestro produces it) nor the stored
baseline. Exclude the top band **only during the diff**, so the clock / notch /
carrier band never register as changes.

**Key insight:** the ratio (status-bar height ÷ screen height) is ~constant
across pixel densities, because both scale by the same factor. So we mask a
**percentage of the image height from the top**, which is resolution-robust.

- iOS: 6% of height
- Android: 4.5% of height
- Web: 0 (no mask)

These are heuristics chosen to safely cover the status bar / notch area; they
are documented as such in code.

### Backend
- `CompareInput` (in `bank/compare.rs`) gains `ignore_status_bar: bool` and
  `platform: String` (`"ios" | "android" | "web"`).
- A helper computes the masked band: `band_h = if ignore_status_bar { round(height * ratio(platform)) } else { 0 }`.
- `diff.rs::diff_images` gains a `mask_top: u32` parameter. Pixels with
  `y < mask_top` are:
  - not compared (never counted as changed),
  - excluded from the ratio denominator (total = compared pixels only),
  - tinted with a subtle overlay (e.g. semi-transparent blue) in the diff PNG so
    the user can see the region was ignored.
- Seeding and dimension-mismatch logic are unaffected (still compare full
  dimensions; masking only affects the pixel diff).

### Frontend
- `visualRegressionStore` gains `ignoreStatusBar: boolean` (persisted),
  **default `false`** (preserves current behavior; user opts in).
- `VisualRegressionSettings` gains a toggle: "Ignore status bar (clock/notch)".
- `App.tsx` post-run flow passes `device.platform` and the `ignoreStatusBar`
  setting into `compareScreenshots`.
- `ipc.ts` `compareScreenshots` args gain `platform` and `ignoreStatusBar`.

---

## Testing

Rust (unit):
- `diff_images` with `mask_top > 0`: an image whose ONLY difference is inside the
  top band yields `changed_ratio == 0` and no bbox.
- `diff_images` with `mask_top > 0`: a difference below the band is still
  detected normally.
- Band-height computation: iOS/Android/Web ratios produce expected pixel heights
  for a sample resolution; `ignore_status_bar=false` → band 0.
- `list_bank`: returns groups/metadata for a temp bank dir; empty when absent.
- Path validation: `delete_bank_image`/`delete_bank_device` reject traversal.

Frontend:
- Light — the page is mostly IPC-driven; verify empty states and that delete
  refreshes the listing. Manual verification via the running app.

---

## Out of scope (v1)
- Reviewing/resolving the last run's diffs from the Image Bank page (stays in the
  modal).
- User-drawn custom ignore regions (only the auto per-platform status-bar band).
- Thumbnail downscaling pipeline (load full PNGs lazily; banks are small).
- Renaming baselines or reorganizing device groups.
