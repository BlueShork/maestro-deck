// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

use std::fs;
use std::path::Path;
use std::time::SystemTime;

use serde::Serialize;

use crate::bank::compare::{compare_flow, CompareInput, Comparison};

#[derive(Serialize, Clone)]
pub struct RunReport {
    pub run_id: String,
    pub device_key: String,
    pub comparisons: Vec<Comparison>,
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
    let flow_dir = flow.parent().map(|p| p.to_path_buf()).unwrap_or_default();

    // Copier les PNG produits dans le dossier de run (source stable pour `replace`).
    let maestro_dir = ws.join("maestro");
    let _ = ensure_runs_gitignore(&maestro_dir);
    let run_dir = maestro_dir.join(".runs").join(&run_id);
    fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;
    let _ = prune_runs(&maestro_dir.join(".runs"), 10);
    let yaml = fs::read_to_string(&flow).unwrap_or_default();
    for name in crate::bank::flow::screenshot_names(&yaml) {
        let produced = flow_dir.join(format!("{name}.png"));
        if produced.exists() {
            let _ = fs::copy(&produced, run_dir.join(format!("{name}.png")));
        }
    }

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
}
