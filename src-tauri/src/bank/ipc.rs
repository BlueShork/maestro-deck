// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::bank::compare::{compare_flow, CompareInput, Comparison};

#[derive(Serialize, Clone)]
pub struct RunReport {
    pub run_id: String,
    pub device_key: String,
    pub comparisons: Vec<Comparison>,
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
) -> Result<RunReport, String> {
    let ws = std::path::PathBuf::from(&workspace);
    let flow = std::path::PathBuf::from(&flow_path);
    let flow_dir = flow.parent().map(|p| p.to_path_buf()).unwrap_or_default();

    // Copier les PNG produits dans le dossier de run (source stable pour `replace`).
    let run_dir = ws.join("maestro").join(".runs").join(&run_id);
    fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;
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
