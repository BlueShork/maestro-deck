# Image Bank page + status-bar masking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-page Image Bank tab to browse/manage screenshot baselines, and an opt-in "ignore status bar" option that excludes the top band of each screenshot from the visual-regression diff.

**Architecture:** Two independent features. Status-bar masking is a per-platform height *ratio* applied inside the Rust pixel diff (`bank/diff.rs`), threaded through `CompareInput` and the `compare_screenshots` command, toggled by a persisted frontend setting. The Image Bank page is a new React route (`/image-bank`) backed by four new Rust commands that list/load/delete PNGs under `<workspace>/maestro/bank/<device_key>/`.

**Tech Stack:** Rust (Tauri v2, `image` 0.25 crate), React + TypeScript, zustand, react-router, Tailwind, vitest, cargo test.

## Global Constraints

- Every new source file starts with the 2-line header:
  `// Copyright (c) 2026 Ethan Morisset` / `// SPDX-License-Identifier: BUSL-1.1`
- Commits are simple — **no `Co-Authored-By` / Claude attribution**.
- A pre-commit hook runs gitleaks + prettier + eslint; run `npx prettier --write <files>` before committing frontend files.
- Frontend must pass `npm run typecheck` (tsc) and `npm run lint` (eslint, max-warnings 0).
- Rust masking uses per-platform ratios: **iOS 0.06, Android 0.045, Web/other 0.0**.
- Status-bar masking default is **OFF** (`ignoreStatusBar: false`).
- Tauri v2 maps JS camelCase args to Rust snake_case params (e.g. JS `ignoreStatusBar` → Rust `ignore_status_bar`).
- Rust tests run from `src-tauri/` via `cargo test <name>`. Frontend tests via `npx vitest run <file>`.

---

## Task 1: Status-bar ratio helper (Rust)

**Files:**
- Modify: `src-tauri/src/bank/mod.rs`

**Interfaces:**
- Produces: `pub fn status_bar_ratio(platform: &str, ignore: bool) -> f64`

- [ ] **Step 1: Write the failing test**

Add to the existing `#[cfg(test)] mod tests` block in `src-tauri/src/bank/mod.rs`:

```rust
    #[test]
    fn status_bar_ratio_per_platform() {
        assert_eq!(status_bar_ratio("ios", true), 0.06);
        assert_eq!(status_bar_ratio("android", true), 0.045);
        assert_eq!(status_bar_ratio("web", true), 0.0);
        assert_eq!(status_bar_ratio("ios", false), 0.0);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test status_bar_ratio_per_platform`
Expected: FAIL to compile — `cannot find function status_bar_ratio`.

- [ ] **Step 3: Write minimal implementation**

Add above the `#[cfg(test)]` block in `src-tauri/src/bank/mod.rs`:

```rust
/// Fraction of the screenshot height (from the top) to exclude from the diff
/// so the status bar (clock / notch / carrier band) doesn't cause false
/// positives. Ratio (not pixels) because status-bar-height ÷ screen-height is
/// ~constant across pixel densities. Returns 0.0 when masking is off or the
/// platform has no status bar (web).
pub fn status_bar_ratio(platform: &str, ignore: bool) -> f64 {
    if !ignore {
        return 0.0;
    }
    match platform {
        "ios" => 0.06,
        "android" => 0.045,
        _ => 0.0,
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test status_bar_ratio_per_platform`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/bank/mod.rs
git commit -m "feat(bank): status-bar ratio helper for diff masking"
```

---

## Task 2: Mask the top band inside `diff_images` (Rust)

**Files:**
- Modify: `src-tauri/src/bank/diff.rs`
- Modify: `src-tauri/src/bank/compare.rs:116` (the single call site)

**Interfaces:**
- Consumes: nothing new.
- Produces: `pub fn diff_images(bank_png: &[u8], new_png: &[u8], tolerance: f64, mask_ratio: f64) -> Result<DiffOutcome, image::ImageError>` — masked rows are excluded from the ratio denominator and tinted blue in `diff_png`.

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/bank/diff.rs`, update the two existing test calls to pass `0.0` and add two masking tests. Replace the whole `#[cfg(test)] mod tests { ... }` block with:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbaImage;

    fn png_bytes(img: &RgbaImage) -> Vec<u8> {
        let mut buf = Vec::new();
        image::codecs::png::PngEncoder::new(&mut buf)
            .write_image(
                img.as_raw(),
                img.width(),
                img.height(),
                image::ExtendedColorType::Rgba8,
            )
            .unwrap();
        buf
    }

    #[test]
    fn identical_images_have_zero_ratio() {
        let img = RgbaImage::from_pixel(4, 4, image::Rgba([10, 20, 30, 255]));
        let out = diff_images(&png_bytes(&img), &png_bytes(&img), 0.1, 0.0).unwrap();
        assert_eq!(out.changed_ratio, 0.0);
        assert!(out.bbox.is_none());
    }

    #[test]
    fn one_changed_pixel_is_detected_with_bbox() {
        let bank = RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 255]));
        let mut new = bank.clone();
        new.put_pixel(2, 1, image::Rgba([255, 255, 255, 255])); // blanc vs noir
        let out = diff_images(&png_bytes(&bank), &png_bytes(&new), 0.1, 0.0).unwrap();
        assert!(out.changed_ratio > 0.0);
        assert_eq!(out.bbox, Some([2, 1, 1, 1]));
    }

    #[test]
    fn change_inside_masked_band_is_ignored() {
        // 4x4, mask_ratio 0.5 -> top 2 rows masked. Change only at (2,1) which is
        // inside the masked band, so nothing is reported.
        let bank = RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 255]));
        let mut new = bank.clone();
        new.put_pixel(2, 1, image::Rgba([255, 255, 255, 255]));
        let out = diff_images(&png_bytes(&bank), &png_bytes(&new), 0.1, 0.5).unwrap();
        assert_eq!(out.changed_ratio, 0.0);
        assert!(out.bbox.is_none());
    }

    #[test]
    fn change_below_masked_band_is_detected() {
        let bank = RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 255]));
        let mut new = bank.clone();
        new.put_pixel(1, 3, image::Rgba([255, 255, 255, 255])); // row 3, below top-2 mask
        let out = diff_images(&png_bytes(&bank), &png_bytes(&new), 0.1, 0.5).unwrap();
        assert!(out.changed_ratio > 0.0);
        assert_eq!(out.bbox, Some([1, 3, 1, 1]));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib bank::diff`
Expected: FAIL to compile — `diff_images` takes 3 args, not 4.

- [ ] **Step 3: Write the implementation**

In `src-tauri/src/bank/diff.rs`, replace the `diff_images` function (lines 12-67) with:

```rust
pub fn diff_images(
    bank_png: &[u8],
    new_png: &[u8],
    tolerance: f64,
    mask_ratio: f64,
) -> Result<DiffOutcome, image::ImageError> {
    let bank = image::load_from_memory(bank_png)?.to_rgba8();
    let mut new = image::load_from_memory(new_png)?.to_rgba8();
    let (w, h) = (new.width(), new.height());

    // Rows [0, mask_top) are excluded from the comparison (status bar).
    let mask_top = (((h as f64) * mask_ratio).round() as u32).min(h);

    // Seuil pixelmatch : delta max possible (noir↔blanc) = 35215.
    let max_delta = 35215.0 * tolerance * tolerance;

    let (mut min_x, mut min_y, mut max_x, mut max_y) = (u32::MAX, u32::MAX, 0u32, 0u32);
    let mut changed = 0u64;

    for y in 0..h {
        for x in 0..w {
            if y < mask_top {
                // Ignored region: tint blue so the reviewer sees it was
                // excluded, and skip the comparison entirely.
                let p = new.get_pixel(x, y).0;
                new.put_pixel(
                    x,
                    y,
                    image::Rgba([
                        (p[0] as u32 * 65 / 100) as u8,
                        (p[1] as u32 * 65 / 100) as u8,
                        ((p[2] as u32 * 65 / 100) + 90).min(255) as u8,
                        255,
                    ]),
                );
                continue;
            }
            let a = bank.get_pixel(x, y).0;
            let b = new.get_pixel(x, y).0;
            if color_delta(a, b) > max_delta {
                changed += 1;
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
                new.put_pixel(x, y, image::Rgba([255, 0, 0, 255]));
            }
        }
    }

    let compared = (w as u64) * ((h - mask_top) as u64);
    let changed_ratio = if compared == 0 {
        0.0
    } else {
        changed as f32 / compared as f32
    };
    let bbox = if changed == 0 {
        None
    } else {
        Some([min_x, min_y, max_x - min_x + 1, max_y - min_y + 1])
    };

    let mut diff_png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut diff_png).write_image(
        new.as_raw(),
        w,
        h,
        image::ExtendedColorType::Rgba8,
    )?;

    Ok(DiffOutcome {
        changed_ratio,
        bbox,
        diff_png,
    })
}
```

Then update the call site in `src-tauri/src/bank/compare.rs`. This is done in Task 3 (which adds the ratio source); for now, to keep this task compiling, change line 116 from:

```rust
        match diff_images(&bank_bytes, &new_bytes, input.tolerance) {
```
to:
```rust
        match diff_images(&bank_bytes, &new_bytes, input.tolerance, 0.0) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib bank::diff && cargo test --lib bank::compare`
Expected: PASS (all diff + compare tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/bank/diff.rs src-tauri/src/bank/compare.rs
git commit -m "feat(bank): exclude masked top band from image diff"
```

---

## Task 3: Thread platform + ignore flag through `CompareInput` (Rust)

**Files:**
- Modify: `src-tauri/src/bank/compare.rs`
- Modify: `src-tauri/src/bank/ipc.rs:111-119` (the `CompareInput { ... }` literal)

**Interfaces:**
- Consumes: `status_bar_ratio` (Task 1), `diff_images(.., mask_ratio)` (Task 2).
- Produces: `CompareInput` with `pub platform: &'a str` and `pub ignore_status_bar: bool`.

- [ ] **Step 1: Write the failing test**

Add to `#[cfg(test)] mod tests` in `src-tauri/src/bank/compare.rs`:

```rust
    #[test]
    fn ignores_change_in_status_bar_band() {
        let ws = temp_dir("statusbar");
        let flow_dir = ws.join("flows");
        let flow_path = flow_dir.join("f.yaml");
        fs::create_dir_all(&flow_dir).unwrap();
        fs::write(&flow_path, "- takeScreenshot: home\n").unwrap();
        let key = device_key("Dev", 10, 100);
        // Baseline: solid black 10x100.
        write_png(
            &ws.join("maestro/bank").join(&key).join("home.png"),
            &RgbaImage::from_pixel(10, 100, image::Rgba([0, 0, 0, 255])),
        );
        // Produced: identical except a changed pixel at y=2 (inside iOS 6% band = top 6 rows).
        let mut produced = RgbaImage::from_pixel(10, 100, image::Rgba([0, 0, 0, 255]));
        produced.put_pixel(5, 2, image::Rgba([255, 255, 255, 255]));
        write_png(&flow_dir.join("home.png"), &produced);

        let (_, comps) = compare_flow(CompareInput {
            workspace: &ws,
            flow_path: &flow_path,
            model: "Dev",
            width: 10,
            height: 100,
            tolerance: 0.1,
            threshold: 0.001,
            platform: "ios",
            ignore_status_bar: true,
        })
        .unwrap();
        assert!(matches!(comps[0].status, Status::Match));
    }
```

Also update the THREE existing `CompareInput { ... }` literals in this test module (in `seeds_when_bank_empty_then_matches_next_run` there are two, and one each in `flags_changed_pixels` and `missing_when_no_produced_file`) to add the two new fields. Add these two lines before the closing `}` of each literal:

```rust
            platform: "android",
            ignore_status_bar: false,
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib bank::compare`
Expected: FAIL to compile — missing fields `platform`, `ignore_status_bar` on `CompareInput`.

- [ ] **Step 3: Write the implementation**

In `src-tauri/src/bank/compare.rs`, extend the `CompareInput` struct (lines 37-45):

```rust
pub struct CompareInput<'a> {
    pub workspace: &'a Path,
    pub flow_path: &'a Path,
    pub model: &'a str,
    pub width: u32,
    pub height: u32,
    pub tolerance: f64,
    pub threshold: f64,
    pub platform: &'a str,
    pub ignore_status_bar: bool,
}
```

In `compare_flow`, compute the ratio once near the top (right after `let names = screenshot_names(&yaml);`):

```rust
    let mask_ratio = crate::bank::status_bar_ratio(input.platform, input.ignore_status_bar);
```

And change the diff call from the Task-2 placeholder:

```rust
        match diff_images(&bank_bytes, &new_bytes, input.tolerance, 0.0) {
```
to:
```rust
        match diff_images(&bank_bytes, &new_bytes, input.tolerance, mask_ratio) {
```

Then update the caller in `src-tauri/src/bank/ipc.rs`. The `compare_screenshots` command builds `CompareInput` (lines 111-119). Add the two fields — the `platform` and `ignore_status_bar` values come from the command params added in Task 4. For now add them referencing params that Task 4 introduces:

```rust
    let (device_key, comparisons) = compare_flow(CompareInput {
        workspace: &ws,
        flow_path: &flow,
        model: &model,
        width,
        height,
        tolerance,
        threshold,
        platform: &platform,
        ignore_status_bar,
    })
    .map_err(|e| e.to_string())?;
```

(This will not compile until Task 4 adds the `platform` / `ignore_status_bar` params — do Task 4 immediately after and run tests at the end of Task 4.)

- [ ] **Step 4: Defer test run to Task 4**

The library won't compile until Task 4 adds the command params. Proceed directly to Task 4, then run `cargo test`.

- [ ] **Step 5: Commit (combined with Task 4)**

Do not commit yet — commit at the end of Task 4.

---

## Task 4: Add params to `compare_screenshots` command (Rust)

**Files:**
- Modify: `src-tauri/src/bank/ipc.rs:82-92` (command signature)

**Interfaces:**
- Produces: `compare_screenshots(.., platform: String, ignore_status_bar: bool)` tauri command.

- [ ] **Step 1: Update the command signature**

In `src-tauri/src/bank/ipc.rs`, change the `compare_screenshots` signature (lines 82-92) to add the two params after `run_id`:

```rust
#[tauri::command]
pub async fn compare_screenshots(
    workspace: String,
    flow_path: String,
    model: String,
    width: u32,
    height: u32,
    tolerance: f64,
    threshold: f64,
    run_id: String,
    platform: String,
    ignore_status_bar: bool,
) -> Result<RunReport, String> {
```

- [ ] **Step 2: Build and run the full bank test suite**

Run: `cd src-tauri && cargo test --lib bank`
Expected: PASS — including `ignores_change_in_status_bar_band` and all pre-existing bank tests.

- [ ] **Step 3: Verify the whole crate compiles**

Run: `cd src-tauri && cargo check`
Expected: no errors (warnings about unused frontend params are fine; there should be none here).

- [ ] **Step 4: Commit (Tasks 3 + 4 together)**

```bash
git add src-tauri/src/bank/compare.rs src-tauri/src/bank/ipc.rs
git commit -m "feat(bank): thread platform + ignore-status-bar through compare"
```

---

## Task 5: Frontend setting `ignoreStatusBar` + settings toggle

**Files:**
- Modify: `src/stores/visualRegressionStore.ts`
- Modify: `src/components/settings/VisualRegressionSettings.tsx`
- Test: `src/stores/visualRegressionStore.test.ts` (create)

**Interfaces:**
- Produces: `useVisualRegressionStore` state gains `ignoreStatusBar: boolean` (default `false`) and `setIgnoreStatusBar: (v: boolean) => void`.

- [ ] **Step 1: Write the failing test**

Create `src/stores/visualRegressionStore.test.ts`:

```ts
// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";

import { useVisualRegressionStore } from "@/stores/visualRegressionStore";

describe("visualRegressionStore ignoreStatusBar", () => {
  it("defaults to false", () => {
    expect(useVisualRegressionStore.getState().ignoreStatusBar).toBe(false);
  });

  it("can be toggled via setIgnoreStatusBar", () => {
    useVisualRegressionStore.getState().setIgnoreStatusBar(true);
    expect(useVisualRegressionStore.getState().ignoreStatusBar).toBe(true);
    useVisualRegressionStore.getState().setIgnoreStatusBar(false);
    expect(useVisualRegressionStore.getState().ignoreStatusBar).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/visualRegressionStore.test.ts`
Expected: FAIL — `ignoreStatusBar`/`setIgnoreStatusBar` are undefined.

- [ ] **Step 3: Implement the store change**

In `src/stores/visualRegressionStore.ts`, add to the `VisualRegressionState` interface (after `threshold`):

```ts
  /** When true, the status-bar band (clock/notch) is excluded from diffs. */
  ignoreStatusBar: boolean;
```
and after `setThreshold`:
```ts
  setIgnoreStatusBar: (v: boolean) => void;
```

In the store initializer, add `ignoreStatusBar: false,` (next to `threshold: null,`) and `setIgnoreStatusBar: (v) => set({ ignoreStatusBar: v }),` (next to `setThreshold`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/visualRegressionStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the settings toggle**

In `src/components/settings/VisualRegressionSettings.tsx`, add selectors inside the component (next to the others):

```ts
  const ignoreStatusBar = useVisualRegressionStore((s) => s.ignoreStatusBar);
  const setIgnoreStatusBar = useVisualRegressionStore((s) => s.setIgnoreStatusBar);
```

Then add a `ToggleRow` right after the "Enable visual regression" ToggleRow:

```tsx
        <ToggleRow
          label="Ignore status bar"
          description="Exclude the top band (clock, notch, carrier) from comparison to avoid false positives. iOS ~6%, Android ~4.5% of the screen height."
          checked={ignoreStatusBar}
          onCheckedChange={setIgnoreStatusBar}
        />
```

- [ ] **Step 6: Typecheck, lint, format**

Run: `npm run typecheck && npx prettier --write src/stores/visualRegressionStore.ts src/stores/visualRegressionStore.test.ts src/components/settings/VisualRegressionSettings.tsx && npx eslint src/stores/visualRegressionStore.ts src/components/settings/VisualRegressionSettings.tsx`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/stores/visualRegressionStore.ts src/stores/visualRegressionStore.test.ts src/components/settings/VisualRegressionSettings.tsx
git commit -m "feat(visual-regression): ignore-status-bar setting + toggle"
```

---

## Task 6: Pass platform + ignoreStatusBar from the frontend

**Files:**
- Modify: `src/lib/ipc.ts:90-99` (compareScreenshots arg type)
- Modify: `src/App.tsx` (the `ipc.compareScreenshots({ ... })` call)

**Interfaces:**
- Consumes: store `ignoreStatusBar` (Task 5), `device.platform`, backend params (Task 4).

- [ ] **Step 1: Extend the ipc arg type**

In `src/lib/ipc.ts`, update the `compareScreenshots` arg object type to add two fields (after `runId: string;`):

```ts
  compareScreenshots: (args: {
    workspace: string;
    flowPath: string;
    model: string;
    width: number;
    height: number;
    tolerance: number;
    threshold: number;
    runId: string;
    platform: Platform;
    ignoreStatusBar: boolean;
  }) => call<RunReport>("compare_screenshots", args),
```

(`Platform` is already imported in `ipc.ts`.)

- [ ] **Step 2: Pass the values from App.tsx**

In `src/App.tsx`, inside the `ipc.compareScreenshots({ ... })` call, add two properties after `runId`:

```ts
                runId,
                platform: device.platform,
                ignoreStatusBar: useVisualRegressionStore.getState().ignoreStatusBar,
```

(`device` and `useVisualRegressionStore` are already in scope here.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Format + lint**

Run: `npx prettier --write src/lib/ipc.ts src/App.tsx && npx eslint src/lib/ipc.ts src/App.tsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ipc.ts src/App.tsx
git commit -m "feat(visual-regression): send platform + ignore-status-bar to compare"
```

---

## Task 7: `list_bank` command + types (Rust)

**Files:**
- Modify: `src-tauri/src/bank/ipc.rs`
- Modify: `src-tauri/src/lib.rs:91-92` (register command)

**Interfaces:**
- Produces: `list_bank(workspace: String) -> Result<Vec<BankGroup>, String>` where
  `BankGroup { device_key: String, images: Vec<BankImage> }` and
  `BankImage { name: String, width: u32, height: u32, size_bytes: u64, modified_ms: u64 }`.

- [ ] **Step 1: Write the failing test**

Add to `#[cfg(test)] mod tests` in `src-tauri/src/bank/ipc.rs`:

```rust
    #[test]
    fn list_bank_reports_groups_and_metadata() {
        use image::{ImageEncoder, RgbaImage};
        let ws = std::env::temp_dir().join("mdbank_list");
        let _ = fs::remove_dir_all(&ws);
        let group = ws.join("maestro/bank/Dev_2x3");
        fs::create_dir_all(&group).unwrap();
        let mut buf = Vec::new();
        let img = RgbaImage::from_pixel(2, 3, image::Rgba([1, 2, 3, 255]));
        image::codecs::png::PngEncoder::new(&mut buf)
            .write_image(img.as_raw(), 2, 3, image::ExtendedColorType::Rgba8)
            .unwrap();
        fs::write(group.join("home.png"), &buf).unwrap();
        fs::write(group.join("notes.txt"), b"ignore me").unwrap();

        let groups =
            tauri::async_runtime::block_on(list_bank(ws.to_string_lossy().to_string())).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].device_key, "Dev_2x3");
        assert_eq!(groups[0].images.len(), 1); // .txt ignored
        assert_eq!(groups[0].images[0].name, "home");
        assert_eq!((groups[0].images[0].width, groups[0].images[0].height), (2, 3));
    }

    #[test]
    fn list_bank_empty_when_no_bank_dir() {
        let ws = std::env::temp_dir().join("mdbank_list_empty");
        let _ = fs::remove_dir_all(&ws);
        fs::create_dir_all(&ws).unwrap();
        let groups =
            tauri::async_runtime::block_on(list_bank(ws.to_string_lossy().to_string())).unwrap();
        assert!(groups.is_empty());
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib bank::ipc::tests::list_bank`
Expected: FAIL to compile — `list_bank` / `BankGroup` not found.

- [ ] **Step 3: Implement**

In `src-tauri/src/bank/ipc.rs`, add near the top (after the existing `use` lines) a base64 import:

```rust
use base64::Engine;
use std::path::PathBuf;
```

Add the structs + command (anywhere after the `use` block, e.g. above `compare_screenshots`):

```rust
#[derive(Serialize, Clone)]
pub struct BankImage {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
    pub modified_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct BankGroup {
    pub device_key: String,
    pub images: Vec<BankImage>,
}

/// Lists every `<workspace>/maestro/bank/<device_key>/*.png` as metadata only
/// (no pixels). Returns an empty vec when the bank directory is absent.
#[tauri::command]
pub async fn list_bank(workspace: String) -> Result<Vec<BankGroup>, String> {
    let bank = PathBuf::from(&workspace)
        .join("maestro")
        .join("bank");
    let mut groups: Vec<BankGroup> = Vec::new();
    let read = match fs::read_dir(&bank) {
        Ok(r) => r,
        Err(_) => return Ok(groups),
    };
    for entry in read.filter_map(|e| e.ok()) {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let device_key = entry.file_name().to_string_lossy().to_string();
        let mut images: Vec<BankImage> = Vec::new();
        if let Ok(files) = fs::read_dir(&dir) {
            for f in files.filter_map(|e| e.ok()) {
                let p = f.path();
                if p.extension().and_then(|e| e.to_str()) != Some("png") {
                    continue;
                }
                let name = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let meta = f.metadata().ok();
                let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                let modified_ms = meta
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                let (width, height) = image::image_dimensions(&p).unwrap_or((0, 0));
                images.push(BankImage {
                    name,
                    width,
                    height,
                    size_bytes,
                    modified_ms,
                });
            }
        }
        images.sort_by(|a, b| a.name.cmp(&b.name));
        groups.push(BankGroup { device_key, images });
    }
    groups.sort_by(|a, b| a.device_key.cmp(&b.device_key));
    Ok(groups)
}
```

Register the command in `src-tauri/src/lib.rs` — add a line in the `generate_handler!` list next to the existing bank commands (after `bank::ipc::resolve_comparison,`):

```rust
            bank::ipc::list_bank,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib bank::ipc`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/bank/ipc.rs src-tauri/src/lib.rs
git commit -m "feat(bank): list_bank command for browsing baselines"
```

---

## Task 8: `load_bank_image` + delete commands (Rust)

**Files:**
- Modify: `src-tauri/src/bank/ipc.rs`
- Modify: `src-tauri/src/lib.rs` (register 3 commands)

**Interfaces:**
- Produces:
  - `load_bank_image(workspace, device_key, name) -> Result<String, String>` (data URI)
  - `delete_bank_image(workspace, device_key, name) -> Result<(), String>`
  - `delete_bank_device(workspace, device_key) -> Result<(), String>`

- [ ] **Step 1: Write the failing tests**

Add to `#[cfg(test)] mod tests` in `src-tauri/src/bank/ipc.rs`:

```rust
    #[test]
    fn safe_component_rejects_traversal() {
        assert!(safe_component("Dev_2x3").is_ok());
        assert!(safe_component("home").is_ok());
        assert!(safe_component("..").is_err());
        assert!(safe_component("a/b").is_err());
        assert!(safe_component("a\\b").is_err());
        assert!(safe_component("").is_err());
    }

    #[test]
    fn delete_image_and_device_remove_files() {
        let ws = std::env::temp_dir().join("mdbank_delete");
        let _ = fs::remove_dir_all(&ws);
        let group = ws.join("maestro/bank/Dev_2x3");
        fs::create_dir_all(&group).unwrap();
        fs::write(group.join("home.png"), b"x").unwrap();
        fs::write(group.join("login.png"), b"y").unwrap();

        let wss = ws.to_string_lossy().to_string();
        tauri::async_runtime::block_on(delete_bank_image(
            wss.clone(),
            "Dev_2x3".into(),
            "home".into(),
        ))
        .unwrap();
        assert!(!group.join("home.png").exists());
        assert!(group.join("login.png").exists());

        tauri::async_runtime::block_on(delete_bank_device(wss, "Dev_2x3".into())).unwrap();
        assert!(!group.exists());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test --lib bank::ipc::tests::safe_component_rejects_traversal`
Expected: FAIL to compile — `safe_component` / delete fns not found.

- [ ] **Step 3: Implement**

In `src-tauri/src/bank/ipc.rs`, add the helper + three commands:

```rust
/// Rejects path components that could escape the bank directory.
fn safe_component(s: &str) -> Result<(), String> {
    if s.is_empty() || s.contains('/') || s.contains('\\') || s.contains("..") {
        return Err(format!("invalid path component: {s:?}"));
    }
    Ok(())
}

fn bank_image_path(workspace: &str, device_key: &str, name: &str) -> PathBuf {
    PathBuf::from(workspace)
        .join("maestro")
        .join("bank")
        .join(device_key)
        .join(format!("{name}.png"))
}

/// Returns one baseline PNG as a `data:image/png;base64,...` URI.
#[tauri::command]
pub async fn load_bank_image(
    workspace: String,
    device_key: String,
    name: String,
) -> Result<String, String> {
    safe_component(&device_key)?;
    safe_component(&name)?;
    let path = bank_image_path(&workspace, &device_key, &name);
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Deletes one baseline PNG.
#[tauri::command]
pub async fn delete_bank_image(
    workspace: String,
    device_key: String,
    name: String,
) -> Result<(), String> {
    safe_component(&device_key)?;
    safe_component(&name)?;
    fs::remove_file(bank_image_path(&workspace, &device_key, &name)).map_err(|e| e.to_string())
}

/// Deletes an entire device-key group directory.
#[tauri::command]
pub async fn delete_bank_device(workspace: String, device_key: String) -> Result<(), String> {
    safe_component(&device_key)?;
    let dir = PathBuf::from(&workspace)
        .join("maestro")
        .join("bank")
        .join(&device_key);
    fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}
```

Register all three in `src-tauri/src/lib.rs` `generate_handler!` (after `bank::ipc::list_bank,`):

```rust
            bank::ipc::load_bank_image,
            bank::ipc::delete_bank_image,
            bank::ipc::delete_bank_device,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib bank::ipc && cargo check`
Expected: PASS + clean check.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/bank/ipc.rs src-tauri/src/lib.rs
git commit -m "feat(bank): load + delete commands for image bank management"
```

---

## Task 9: Frontend bank types + ipc methods

**Files:**
- Modify: `src/types/visualRegression.ts`
- Modify: `src/lib/ipc.ts`

**Interfaces:**
- Produces: `BankImage`, `BankGroup` types; `ipc.listBank`, `ipc.loadBankImage`, `ipc.deleteBankImage`, `ipc.deleteBankDevice`.

- [ ] **Step 1: Add types**

Append to `src/types/visualRegression.ts`:

```ts
export interface BankImage {
  name: string;
  width: number;
  height: number;
  size_bytes: number;
  modified_ms: number;
}

export interface BankGroup {
  device_key: string;
  images: BankImage[];
}
```

- [ ] **Step 2: Import the type in ipc.ts**

In `src/lib/ipc.ts`, change the existing visualRegression import:

```ts
import type { BankGroup, RunReport } from "@/types/visualRegression";
```

- [ ] **Step 3: Add ipc methods**

In `src/lib/ipc.ts`, add after the `resolveComparison` method:

```ts
  listBank: (workspace: string) => call<BankGroup[]>("list_bank", { workspace }),
  loadBankImage: (workspace: string, deviceKey: string, name: string) =>
    call<string>("load_bank_image", { workspace, deviceKey, name }),
  deleteBankImage: (workspace: string, deviceKey: string, name: string) =>
    call<void>("delete_bank_image", { workspace, deviceKey, name }),
  deleteBankDevice: (workspace: string, deviceKey: string) =>
    call<void>("delete_bank_device", { workspace, deviceKey }),
```

- [ ] **Step 4: Typecheck + format + lint**

Run: `npm run typecheck && npx prettier --write src/types/visualRegression.ts src/lib/ipc.ts && npx eslint src/types/visualRegression.ts src/lib/ipc.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/visualRegression.ts src/lib/ipc.ts
git commit -m "feat(bank): frontend types + ipc for image bank"
```

---

## Task 10: Image Bank page + route + toolbar entry

**Files:**
- Create: `src/components/ImageBankPage.tsx`
- Modify: `src/App.tsx` (import, route, hide MainView, suppress shortcuts)
- Modify: `src/components/Toolbar.tsx` (Images button)

**Interfaces:**
- Consumes: `ipc.listBank`, `ipc.loadBankImage`, `ipc.deleteBankImage`, `ipc.deleteBankDevice`, `BankGroup`, `useWorkspaceStore`.
- Produces: `<ImageBankPage />` rendered at route `/image-bank`.

- [ ] **Step 1: Create the page component**

Create `src/components/ImageBankPage.tsx`:

```tsx
// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ArrowLeft, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { BankGroup, BankImage } from "@/types/visualRegression";

/** Lazy-loaded thumbnail: fetches its own base64 so the listing stays cheap. */
function Thumb({
  workspace,
  deviceKey,
  image,
  onOpen,
  onDelete,
}: {
  workspace: string;
  deviceKey: string;
  image: BankImage;
  onOpen: (src: string) => void;
  onDelete: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    void ipc
      .loadBankImage(workspace, deviceKey, image.name)
      .then((s) => {
        if (alive) setSrc(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspace, deviceKey, image.name]);

  return (
    <div className="group relative flex flex-col gap-1 rounded-lg border border-border p-2">
      <button
        type="button"
        onClick={() => src && onOpen(src)}
        className="flex aspect-[9/16] items-center justify-center overflow-hidden rounded bg-muted/40"
        aria-label={`Open ${image.name}`}
      >
        {src ? (
          <img src={src} alt={image.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[10px] text-muted-foreground">loading…</span>
        )}
      </button>
      <div className="flex items-center justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{image.name}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {image.width}×{image.height}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirming) onDelete();
            else {
              setConfirming(true);
              window.setTimeout(() => setConfirming(false), 3000);
            }
          }}
          className={cn(
            "shrink-0 rounded px-1.5 py-1 text-[10px] transition-colors",
            confirming
              ? "bg-red-500/15 text-red-600 dark:text-red-400"
              : "text-muted-foreground hover:bg-accent",
          )}
          aria-label={confirming ? `Confirm delete ${image.name}` : `Delete ${image.name}`}
        >
          {confirming ? "Confirm?" : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export function ImageBankPage() {
  const navigate = useNavigate();
  const folderPath = useWorkspaceStore((s) => s.folderPath);
  const [groups, setGroups] = useState<BankGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [confirmGroup, setConfirmGroup] = useState(false);

  const refresh = useCallback(async () => {
    if (!folderPath) {
      setGroups([]);
      setSelected(null);
      return;
    }
    setLoading(true);
    try {
      const g = await ipc.listBank(folderPath);
      setGroups(g);
      setSelected((prev) =>
        prev && g.some((x) => x.device_key === prev) ? prev : (g[0]?.device_key ?? null),
      );
    } finally {
      setLoading(false);
    }
  }, [folderPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lightbox) setLightbox(null);
      else navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, lightbox]);

  const activeGroup = groups.find((g) => g.device_key === selected) ?? null;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => navigate("/")}
          aria-label="Back to workspace"
          title="Back to workspace (Esc)"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-semibold">Image Bank</span>
      </header>

      {!folderPath ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          Open a folder to use the image bank.
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          {loading ? "Loading…" : "No baselines yet. Run a flow with takeScreenshot to seed the bank."}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav className="w-56 shrink-0 overflow-y-auto border-r border-border p-2">
            {groups.map((g) => (
              <button
                key={g.device_key}
                type="button"
                onClick={() => setSelected(g.device_key)}
                aria-current={selected === g.device_key ? "page" : undefined}
                className={cn(
                  "w-full rounded px-3 py-1.5 text-left text-xs transition-colors",
                  selected === g.device_key
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <div className="truncate font-mono">{g.device_key}</div>
                <div className="text-[10px] text-muted-foreground">{g.images.length} image(s)</div>
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {activeGroup ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-mono text-xs text-muted-foreground">
                    {activeGroup.device_key}
                  </div>
                  <Button
                    size="xs"
                    variant={confirmGroup ? "destructive" : "outline"}
                    onClick={() => {
                      if (confirmGroup) {
                        void ipc
                          .deleteBankDevice(folderPath, activeGroup.device_key)
                          .then(refresh)
                          .finally(() => setConfirmGroup(false));
                      } else {
                        setConfirmGroup(true);
                        window.setTimeout(() => setConfirmGroup(false), 3000);
                      }
                    }}
                  >
                    {confirmGroup ? "Confirm delete group?" : "Delete group"}
                  </Button>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                  {activeGroup.images.map((img) => (
                    <Thumb
                      key={img.name}
                      workspace={folderPath}
                      deviceKey={activeGroup.device_key}
                      image={img}
                      onOpen={setLightbox}
                      onDelete={() =>
                        void ipc
                          .deleteBankImage(folderPath, activeGroup.device_key, img.name)
                          .then(refresh)
                      }
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="preview"
            className="max-h-[92vh] max-w-[92vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Wire the route in App.tsx**

In `src/App.tsx`:

Add the import (next to the other component imports):

```ts
import { ImageBankPage } from "@/components/ImageBankPage";
```

Add an `imageBankOpen` flag next to `settingsOpen` (line ~45):

```ts
  const imageBankOpen = location.pathname.startsWith("/image-bank");
```

Update the shortcut-suppression effect to include it:

```ts
  useEffect(() => {
    setShortcutsSuppressed(settingsOpen || imageBankOpen);
    return () => setShortcutsSuppressed(false);
  }, [settingsOpen, imageBankOpen]);
```

Update the MainView hide wrapper:

```tsx
      <div className={settingsOpen || imageBankOpen ? "hidden" : "contents"}>
        <MainView />
      </div>
```

Add the route inside `<Routes>` (before the `path="*"` catch-all):

```tsx
        <Route path="/image-bank" element={<ImageBankPage />} />
```

- [ ] **Step 3: Add the toolbar button**

In `src/components/Toolbar.tsx`, add `Images` to the lucide import list (keep alphabetical grouping loose — insert near `ListChecks`):

```ts
  Images,
```

Add a button just before the Settings `<Tooltip>` block (after the Documentation button):

```tsx
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => navigate("/image-bank")}
                aria-label="Open image bank"
              >
                <Images className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Image bank</TooltipContent>
          </Tooltip>
```

- [ ] **Step 4: Typecheck + format + lint**

Run: `npm run typecheck && npx prettier --write src/components/ImageBankPage.tsx src/App.tsx src/components/Toolbar.tsx && npx eslint src/components/ImageBankPage.tsx src/App.tsx src/components/Toolbar.tsx`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run the app (`npm run tauri dev` or the project's run skill). Open a workspace folder that has a seeded bank (or run a flow with `takeScreenshot` first). Click the new Images button in the toolbar → the Image Bank page opens full-screen, lists device groups, shows a thumbnail grid; clicking a thumbnail opens the lightbox; Esc/back returns to the workspace.
Expected: all of the above work; deleting an image or group removes it and the grid refreshes.

- [ ] **Step 6: Commit**

```bash
git add src/components/ImageBankPage.tsx src/App.tsx src/components/Toolbar.tsx
git commit -m "feat(bank): full-page Image Bank tab to browse + manage baselines"
```

---

## Self-Review notes (already applied)

- **Spec coverage:** Feature 1 (page: browse=Task 10, load=Tasks 7/9/10, delete image+group=Tasks 8/10; route + toolbar=Task 10). Feature 2 (ratio=Task 1, diff mask=Task 2, CompareInput=Task 3, command=Task 4, setting+toggle=Task 5, wiring=Task 6). Out-of-scope items (last-run review on page, custom regions, thumbnails, rename) intentionally omitted.
- **Type consistency:** `diff_images(.., mask_ratio: f64)` used identically in Tasks 2/3; `status_bar_ratio(&str, bool)` in Tasks 1/3; `CompareInput.platform: &str` + `ignore_status_bar: bool` in Tasks 3/4; JS `platform`/`ignoreStatusBar` → Rust `platform`/`ignore_status_bar` in Tasks 4/6; `BankGroup`/`BankImage` fields identical across Rust (Task 7) and TS (Task 9); ipc method names (`listBank`, `loadBankImage`, `deleteBankImage`, `deleteBankDevice`) identical in Tasks 9/10.
- **Ordering caveat:** Tasks 3 + 4 must land together (Task 3 references params introduced in Task 4); the plan defers the build/commit to Task 4.
