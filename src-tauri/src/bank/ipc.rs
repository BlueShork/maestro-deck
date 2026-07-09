// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

use std::fs;
use std::path::Path;
use std::time::SystemTime;

use base64::Engine;
use serde::Serialize;

use crate::bank::compare::{compare_flow, CompareInput, Comparison, Status};
use std::path::PathBuf;

#[derive(Serialize, Clone)]
pub struct RunReport {
    pub run_id: String,
    pub device_key: String,
    pub comparisons: Vec<Comparison>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub flow_errors: Vec<String>,
}

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

/// Ensures `<maestro_dir>/.gitignore` exists and contains `.runs/`.
/// If the file does not exist it is created with `.runs/\n`.
/// If it already exists it is left untouched.
fn ensure_runs_gitignore(maestro_dir: &Path) -> std::io::Result<()> {
    let gi = maestro_dir.join(".gitignore");
    if !gi.exists() {
        fs::write(&gi, ".runs/\n")?;
    }
    Ok(())
}

/// Keeps only the most recent `keep` subdirectories of `runs_dir` by
/// last-modified time, removing older ones. Best-effort: errors on individual
/// entries are ignored.
fn prune_runs(runs_dir: &Path, keep: usize) -> std::io::Result<()> {
    let mut entries: Vec<(SystemTime, std::path::PathBuf)> = fs::read_dir(runs_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let mtime = e.metadata().ok()?.modified().ok()?;
            Some((mtime, e.path()))
        })
        .collect();

    if entries.len() <= keep {
        return Ok(());
    }

    // Sort ascending (oldest first) so we remove from the front.
    entries.sort_by_key(|(t, _)| *t);
    let to_remove = entries.len() - keep;
    for (_, path) in entries.into_iter().take(to_remove) {
        let _ = fs::remove_dir_all(&path);
    }
    Ok(())
}

/// Top-level flow files of a workspace, mirroring what `maestro test <dir>`
/// executes: `*.yaml` / `*.yml` directly in the folder, `config.yaml`
/// excluded, sorted by name. Entries are matched by extension only — an
/// unreadable "flow" surfaces later as a per-flow error, not a silent skip.
fn discover_flows(workspace: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut flows: Vec<PathBuf> = fs::read_dir(workspace)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            matches!(
                p.extension().and_then(|e| e.to_str()),
                Some("yaml") | Some("yml")
            )
        })
        .filter(|p| {
            p.file_name().and_then(|n| n.to_str()) != Some("config.yaml")
                && p.file_name().and_then(|n| n.to_str()) != Some("config.yml")
        })
        .collect();
    flows.sort();
    Ok(flows)
}

/// Ranks statuses so same-name comparisons across flows keep the one the
/// user must actually look at (they share a single flat baseline anyway).
fn severity(s: &Status) -> u8 {
    match s {
        Status::Changed => 5,
        Status::DimensionMismatch => 4,
        Status::Missing => 3,
        Status::Seeded => 2,
        Status::Match => 1,
    }
}

/// Copies the PNGs a flow produced next to it into the run directory (stable
/// source for `resolve_comparison`'s replace). Shared by both compare commands.
fn stage_run_pngs(flow: &Path, run_dir: &Path) {
    let flow_dir = flow.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let yaml = fs::read_to_string(flow).unwrap_or_default();
    for name in crate::bank::flow::screenshot_names(&yaml) {
        let produced = flow_dir.join(format!("{name}.png"));
        if produced.exists() {
            let _ = fs::copy(&produced, run_dir.join(format!("{name}.png")));
        }
    }
}

/// Lists every `<workspace>/maestro/bank/<device_key>/*.png` as metadata only
/// (no pixels). Returns an empty vec when the bank directory is absent.
#[tauri::command]
pub async fn list_bank(workspace: String) -> Result<Vec<BankGroup>, String> {
    let bank = PathBuf::from(&workspace).join("maestro").join("bank");
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

/// Remplace l'image de banque `<workspace>/maestro/bank/<key>/<name>.png`
/// par la nouvelle capture stockée dans `<workspace>/maestro/.runs/<run_id>/<name>.png`.
/// (La nouvelle capture est copiée dans le dossier de run par `compare_screenshots`.)
pub fn replace_bank_image(
    workspace: &Path,
    run_id: &str,
    device_key: &str,
    name: &str,
) -> std::io::Result<()> {
    let src = workspace
        .join("maestro")
        .join(".runs")
        .join(run_id)
        .join(format!("{name}.png"));
    let dst = workspace
        .join("maestro")
        .join("bank")
        .join(device_key)
        .join(format!("{name}.png"));
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(src, dst)?;
    Ok(())
}

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
    let ws = std::path::PathBuf::from(&workspace);
    let flow = std::path::PathBuf::from(&flow_path);

    // Copier les PNG produits dans le dossier de run (source stable pour `replace`).
    let maestro_dir = ws.join("maestro");
    let _ = ensure_runs_gitignore(&maestro_dir);
    let run_dir = maestro_dir.join(".runs").join(&run_id);
    fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;
    let _ = prune_runs(&maestro_dir.join(".runs"), 10);
    stage_run_pngs(&flow, &run_dir);

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

    // report.json slim (statuts seulement, sans base64).
    let slim: Vec<_> = comparisons
        .iter()
        .map(|c| serde_json::json!({ "name": c.name, "status": c.status, "changed_ratio": c.changed_ratio }))
        .collect();
    let report =
        serde_json::json!({ "run_id": run_id, "device_key": device_key, "comparisons": slim });
    let _ = fs::write(
        run_dir.join("report.json"),
        serde_json::to_vec_pretty(&report).unwrap_or_default(),
    );

    Ok(RunReport {
        run_id,
        device_key,
        comparisons,
        flow_errors: Vec::new(),
    })
}

#[tauri::command]
pub async fn resolve_comparison(
    workspace: String,
    run_id: String,
    device_key: String,
    name: String,
    decision: String,
) -> Result<(), String> {
    if decision == "replace" {
        // "replace": la nouvelle capture (copiée dans le dossier de run) devient la vérité.
        replace_bank_image(Path::new(&workspace), &run_id, &device_key, &name)
            .map_err(|e| e.to_string())?;
    }
    // "keep": régression confirmée, banque inchangée (déjà tracée dans report.json).
    Ok(())
}

#[tauri::command]
pub async fn compare_screenshots_all(
    workspace: String,
    model: String,
    width: u32,
    height: u32,
    tolerance: f64,
    threshold: f64,
    run_id: String,
    platform: String,
    ignore_status_bar: bool,
) -> Result<RunReport, String> {
    let ws = PathBuf::from(&workspace);
    let flows = discover_flows(&ws).map_err(|e| e.to_string())?;

    let maestro_dir = ws.join("maestro");
    let _ = ensure_runs_gitignore(&maestro_dir);
    let run_dir = maestro_dir.join(".runs").join(&run_id);
    fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;
    let _ = prune_runs(&maestro_dir.join(".runs"), 10);

    let mut device_key = String::new();
    let mut merged: Vec<Comparison> = Vec::new();
    let mut flow_errors: Vec<String> = Vec::new();

    for flow in &flows {
        let stem = flow
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if fs::metadata(flow).map(|m| !m.is_file()).unwrap_or(true) {
            flow_errors.push(format!("{stem}: not a readable flow file"));
            continue;
        }
        stage_run_pngs(flow, &run_dir);
        match compare_flow(CompareInput {
            workspace: &ws,
            flow_path: flow,
            model: &model,
            width,
            height,
            tolerance,
            threshold,
            platform: &platform,
            ignore_status_bar,
        }) {
            Ok((key, comps)) => {
                if device_key.is_empty() {
                    device_key = key;
                }
                for mut c in comps {
                    c.flow = Some(stem.clone());
                    match merged.iter_mut().find(|m| m.name == c.name) {
                        Some(existing) => {
                            if severity(&c.status) > severity(&existing.status) {
                                *existing = c;
                            }
                        }
                        None => merged.push(c),
                    }
                }
            }
            Err(e) => flow_errors.push(format!("{stem}: {e}")),
        }
    }

    if device_key.is_empty() && merged.is_empty() && !flow_errors.is_empty() {
        return Err(format!(
            "no flow could be compared: {}",
            flow_errors.join(" | ")
        ));
    }

    // report.json slim, same shape as the single-flow command.
    let slim: Vec<_> = merged
        .iter()
        .map(|c| {
            serde_json::json!({ "name": c.name, "status": c.status, "changed_ratio": c.changed_ratio, "flow": c.flow })
        })
        .collect();
    let report =
        serde_json::json!({ "run_id": run_id, "device_key": device_key, "comparisons": slim });
    let _ = fs::write(
        run_dir.join("report.json"),
        serde_json::to_vec_pretty(&report).unwrap_or_default(),
    );

    Ok(RunReport {
        run_id,
        device_key,
        comparisons: merged,
        flow_errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_runs_gitignore_creates_when_absent() {
        let dir = std::env::temp_dir().join("mdbank_gi_test_absent");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        ensure_runs_gitignore(&dir).unwrap();
        let contents = fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert!(contents.contains(".runs/"), "should contain .runs/");
    }

    #[test]
    fn ensure_runs_gitignore_leaves_existing_untouched() {
        let dir = std::env::temp_dir().join("mdbank_gi_test_existing");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(".gitignore"), "custom content\n").unwrap();
        ensure_runs_gitignore(&dir).unwrap();
        let contents = fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert_eq!(
            contents, "custom content\n",
            "existing file must not be modified"
        );
    }

    #[test]
    fn prune_runs_keeps_newest_dirs() {
        let dir = std::env::temp_dir().join("mdbank_prune_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // Create 15 dirs in sequence; last-created will have newest mtime.
        let keep = 10_usize;
        let total = 15_usize;
        for i in 0..total {
            let sub = dir.join(format!("run_{:02}", i));
            fs::create_dir_all(&sub).unwrap();
            // Touch a file inside so mtime differs between iterations
            // (directory mtime is set when we create a child on most OSes).
            fs::write(sub.join("marker"), format!("{i}")).unwrap();
        }

        prune_runs(&dir, keep).unwrap();

        let remaining: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .collect();
        assert_eq!(remaining.len(), keep, "should keep exactly {keep} dirs");

        // The last-created dir (run_14) must still be present.
        assert!(
            dir.join("run_14").exists(),
            "newest dir run_14 must survive"
        );
    }

    #[test]
    fn replace_overwrites_bank_with_run_image() {
        let ws = std::env::temp_dir().join("mdbank_replace");
        let _ = fs::remove_dir_all(&ws);
        let bank = ws.join("maestro/bank/Dev_2x2");
        let run = ws.join("maestro/.runs/r1");
        fs::create_dir_all(&bank).unwrap();
        fs::create_dir_all(&run).unwrap();
        fs::write(bank.join("home.png"), b"OLD").unwrap();
        fs::write(run.join("home.png"), b"NEW").unwrap();

        replace_bank_image(&ws, "r1", "Dev_2x2", "home").unwrap();
        assert_eq!(fs::read(bank.join("home.png")).unwrap(), b"NEW");
    }

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
        assert_eq!(
            (groups[0].images[0].width, groups[0].images[0].height),
            (2, 3)
        );
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

    #[test]
    fn safe_component_rejects_traversal() {
        assert!(safe_component("Dev_2x3").is_ok());
        assert!(safe_component("home").is_ok());
        assert!(safe_component("..").is_err());
        assert!(safe_component("a/b").is_err());
        assert!(safe_component("a\\b").is_err());
        assert!(safe_component("").is_err());
    }

    fn write_test_png(path: &Path, w: u32, h: u32, px: [u8; 4]) {
        use image::{ImageEncoder, RgbaImage};
        let mut buf = Vec::new();
        let img = RgbaImage::from_pixel(w, h, image::Rgba(px));
        image::codecs::png::PngEncoder::new(&mut buf)
            .write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgba8)
            .unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, buf).unwrap();
    }

    #[test]
    fn discover_flows_lists_top_level_yaml_skipping_config() {
        let ws = std::env::temp_dir().join("mdbank_discover");
        let _ = fs::remove_dir_all(&ws);
        fs::create_dir_all(ws.join("sub")).unwrap();
        fs::write(ws.join("b_flow.yaml"), "- launchApp\n").unwrap();
        fs::write(ws.join("a_flow.yml"), "- launchApp\n").unwrap();
        fs::write(ws.join("config.yaml"), "flows: []\n").unwrap();
        fs::write(ws.join("notes.txt"), "x").unwrap();
        fs::write(ws.join("sub/nested.yaml"), "- launchApp\n").unwrap();

        let flows = discover_flows(&ws).unwrap();
        let names: Vec<_> = flows
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["a_flow.yml", "b_flow.yaml"]); // sorted, no config/nested/txt
    }

    #[test]
    fn severity_prefers_changed_over_match() {
        use crate::bank::compare::Status;
        assert!(severity(&Status::Changed) > severity(&Status::DimensionMismatch));
        assert!(severity(&Status::DimensionMismatch) > severity(&Status::Missing));
        assert!(severity(&Status::Missing) > severity(&Status::Seeded));
        assert!(severity(&Status::Seeded) > severity(&Status::Match));
    }

    #[test]
    fn compare_all_merges_flows_and_tags_them() {
        let ws = std::env::temp_dir().join("mdbank_all_merge");
        let _ = fs::remove_dir_all(&ws);
        fs::create_dir_all(&ws).unwrap();
        fs::write(ws.join("login.yaml"), "- takeScreenshot: login_home\n").unwrap();
        fs::write(
            ws.join("checkout.yaml"),
            "- takeScreenshot: checkout_cart\n",
        )
        .unwrap();
        write_test_png(&ws.join("login_home.png"), 2, 2, [1, 2, 3, 255]);
        write_test_png(&ws.join("checkout_cart.png"), 2, 2, [4, 5, 6, 255]);

        let report = tauri::async_runtime::block_on(compare_screenshots_all(
            ws.to_string_lossy().to_string(),
            "Dev".into(),
            2,
            2,
            0.1,
            0.001,
            "r1".into(),
            "android".into(),
            false,
        ))
        .unwrap();

        assert_eq!(report.comparisons.len(), 2);
        let flows: Vec<_> = report
            .comparisons
            .iter()
            .map(|c| c.flow.clone().unwrap())
            .collect();
        assert!(flows.contains(&"login".to_string()));
        assert!(flows.contains(&"checkout".to_string()));
        assert!(report.flow_errors.is_empty());
        // Both seeded into the same flat bank.
        assert!(ws
            .join("maestro/bank")
            .join(&report.device_key)
            .join("login_home.png")
            .exists());
    }

    #[test]
    fn compare_all_dedupes_same_name_keeping_worst_status() {
        let ws = std::env::temp_dir().join("mdbank_all_dedupe");
        let _ = fs::remove_dir_all(&ws);
        fs::create_dir_all(&ws).unwrap();
        // Two flows take a screenshot with the SAME name.
        fs::write(ws.join("a.yaml"), "- takeScreenshot: shared\n").unwrap();
        fs::write(ws.join("b.yaml"), "- takeScreenshot: shared\n").unwrap();
        // Baseline black; produced white → Changed for both flows.
        let key = crate::bank::device_key("Dev", 4, 4);
        write_test_png(
            &ws.join("maestro/bank").join(&key).join("shared.png"),
            4,
            4,
            [0, 0, 0, 255],
        );
        write_test_png(&ws.join("shared.png"), 4, 4, [255, 255, 255, 255]);

        let report = tauri::async_runtime::block_on(compare_screenshots_all(
            ws.to_string_lossy().to_string(),
            "Dev".into(),
            4,
            4,
            0.1,
            0.001,
            "r1".into(),
            "android".into(),
            false,
        ))
        .unwrap();

        let shared: Vec<_> = report
            .comparisons
            .iter()
            .filter(|c| c.name == "shared")
            .collect();
        assert_eq!(shared.len(), 1, "same-name comparisons must be deduped");
    }

    #[test]
    fn compare_all_continues_past_a_failing_flow() {
        let ws = std::env::temp_dir().join("mdbank_all_partial");
        let _ = fs::remove_dir_all(&ws);
        fs::create_dir_all(&ws).unwrap();
        fs::write(ws.join("good.yaml"), "- takeScreenshot: good_home\n").unwrap();
        write_test_png(&ws.join("good_home.png"), 2, 2, [1, 2, 3, 255]);
        // A yaml that is a DIRECTORY: read_to_string fails → flow error path.
        fs::create_dir_all(ws.join("broken.yaml")).unwrap();

        let report = tauri::async_runtime::block_on(compare_screenshots_all(
            ws.to_string_lossy().to_string(),
            "Dev".into(),
            2,
            2,
            0.1,
            0.001,
            "r1".into(),
            "android".into(),
            false,
        ))
        .unwrap();

        assert_eq!(report.comparisons.len(), 1);
        assert_eq!(report.flow_errors.len(), 1);
        assert!(report.flow_errors[0].contains("broken"));
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
}
