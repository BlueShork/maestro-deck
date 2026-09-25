# Banque de screenshots & régression visuelle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maintenir une banque de screenshots de référence par device et signaler les régressions visuelles entre runs, avec revue utilisateur (garder la banque / remplacer).

**Architecture:** Rust = moteur pur (crate `image`, diff YIQ pixelmatch, I/O banque) exposé via deux commandes Tauri. Le front orchestre : à la fin d'un run réussi (`runner:exit` code 0), il appelle `compare_screenshots` avec les seuils (Paramètres), le device et le workspace ; le rapport renvoyé alimente une modale de revue. Les `takeScreenshot: <nom>` du flow YAML produisent `<nom>.png` à côté du flow (CWD du runner fixé sur le dossier du flow).

**Tech Stack:** Rust (Tauri 2, tokio, serde, crate `image`), React + TypeScript + Zustand + Vitest.

## Global Constraints

- En-tête de licence en tête de **chaque nouveau fichier** (copier verbatim depuis un fichier voisin existant) :
  `// Copyright (c) 2026 Ethan Morisset` puis `// SPDX-License-Identifier: BUSL-1.1`.
- Commits **sans** attribution Claude / Co-Authored-By.
- Clé device = `<model>_<screen_width>x<screen_height>`, sanitizée (tout caractère non `[A-Za-z0-9]` → `_`).
- Emplacement banque : `<workspace>/maestro/bank/<key>/<nom>.png` ; runs : `<workspace>/maestro/.runs/<run_id>/`.
- Seuils par défaut : `tolerance = 0.1` (delta couleur par pixel, échelle pixelmatch), `threshold = 0.001` (ratio de pixels changés).
- Aucun traitement de banque si le run échoue (exit ≠ 0) : orchestré côté front (n'appelle `compare_screenshots` que si `code === 0`).
- Tests Rust : `cargo test` dans `src-tauri/`. Tests front : `pnpm test` (vitest, fichiers `src/**/*.test.ts(x)`).
- Imports front via alias `@/` (ex: `@/stores/...`).

---

### Task 1: Module `bank` + clé device + dépendance `image`

**Files:**
- Modify: `src-tauri/Cargo.toml` (section `[dependencies]`)
- Create: `src-tauri/src/bank/mod.rs`
- Modify: `src-tauri/src/lib.rs` (déclaration du module)

**Interfaces:**
- Produces: `pub fn device_key(model: &str, width: u32, height: u32) -> String`

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à la fin de `src-tauri/src/bank/mod.rs` (créer le fichier avec l'en-tête licence) :

```rust
// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

pub fn device_key(model: &str, width: u32, height: u32) -> String {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_key_sanitizes_and_appends_resolution() {
        assert_eq!(device_key("iPhone 15 Pro", 1179, 2556), "iPhone_15_Pro_1179x2556");
        assert_eq!(device_key("Pixel/6", 1080, 2400), "Pixel_6_1080x2400");
    }
}
```

Déclarer le module dans `src-tauri/src/lib.rs` (à côté des autres `mod ...;`, ex. près de `mod runner;`) :

```rust
mod bank;
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `cd src-tauri && cargo test bank::tests::device_key_sanitizes -- --nocapture`
Expected: PANIC `not yet implemented` (todo!).

- [ ] **Step 3: Implémenter**

Remplacer le corps de `device_key` :

```rust
pub fn device_key(model: &str, width: u32, height: u32) -> String {
    let sanitized: String = model
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{sanitized}_{width}x{height}")
}
```

- [ ] **Step 4: Ajouter la dépendance `image`**

Dans `src-tauri/Cargo.toml`, sous `[dependencies]`, ajouter (PNG uniquement, pas de features superflues) :

```toml
image = { version = "0.25", default-features = false, features = ["png"] }
```

- [ ] **Step 5: Lancer le test, vérifier le succès**

Run: `cd src-tauri && cargo test bank::tests::device_key_sanitizes`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/bank/mod.rs src-tauri/src/lib.rs
git commit -m "feat(bank): module + device_key + image crate"
```

---

### Task 2: Extraction des noms `takeScreenshot` du flow YAML

**Files:**
- Create: `src-tauri/src/bank/flow.rs`
- Modify: `src-tauri/src/bank/mod.rs` (ajouter `pub mod flow;`)

**Interfaces:**
- Produces: `pub fn screenshot_names(flow_yaml: &str) -> Vec<String>`
  Extrait, dans l'ordre, les noms des commandes `takeScreenshot`. Supporte la forme courte
  (`- takeScreenshot: login`) et la forme objet (`- takeScreenshot:\n    path: login`).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src-tauri/src/bank/flow.rs` :

```rust
// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/// Extrait les noms des commandes `takeScreenshot` d'un flow Maestro, dans l'ordre.
pub fn screenshot_names(flow_yaml: &str) -> Vec<String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_short_and_object_forms() {
        let yaml = r#"
appId: com.example
---
- launchApp
- takeScreenshot: login
- tapOn: "Next"
- takeScreenshot:
    path: home
"#;
        assert_eq!(screenshot_names(yaml), vec!["login".to_string(), "home".to_string()]);
    }

    #[test]
    fn returns_empty_when_none() {
        assert_eq!(screenshot_names("- launchApp\n").len(), 0);
    }
}
```

Ajouter dans `src-tauri/src/bank/mod.rs`, sous l'en-tête, avant `device_key` :

```rust
pub mod flow;
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `cd src-tauri && cargo test bank::flow`
Expected: PANIC `not yet implemented`.

- [ ] **Step 3: Implémenter (parsing ligne à ligne, sans dépendance YAML)**

Remplacer le corps de `screenshot_names` :

```rust
pub fn screenshot_names(flow_yaml: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut lines = flow_yaml.lines().peekable();
    while let Some(raw) = lines.next() {
        let line = raw.trim_start_matches('-').trim();
        let Some(rest) = line.strip_prefix("takeScreenshot:") else {
            continue;
        };
        let inline = rest.trim();
        if !inline.is_empty() {
            // Forme courte: `takeScreenshot: name`
            names.push(unquote(inline));
        } else if let Some(next) = lines.peek() {
            // Forme objet: `path: name` sur la ligne suivante
            if let Some(path) = next.trim().strip_prefix("path:") {
                names.push(unquote(path.trim()));
            }
        }
    }
    names
}

fn unquote(s: &str) -> String {
    s.trim_matches(|c| c == '"' || c == '\'').to_string()
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `cd src-tauri && cargo test bank::flow`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/bank/flow.rs src-tauri/src/bank/mod.rs
git commit -m "feat(bank): extract takeScreenshot names from flow yaml"
```

---

### Task 3: Cœur du diff pixel (YIQ pixelmatch)

**Files:**
- Create: `src-tauri/src/bank/diff.rs`
- Modify: `src-tauri/src/bank/mod.rs` (ajouter `pub mod diff;`)

**Interfaces:**
- Produces:
  ```rust
  pub struct DiffOutcome {
      pub changed_ratio: f32,
      pub bbox: Option<[u32; 4]>,   // x, y, w, h des pixels changés
      pub diff_png: Vec<u8>,        // PNG: copie de `new` avec pixels changés en rouge
  }
  pub fn diff_images(bank_png: &[u8], new_png: &[u8], tolerance: f64) -> Result<DiffOutcome, image::ImageError>
  ```
  Renvoie une erreur si l'un des PNG ne décode pas. (Les dimensions différentes sont gérées
  par l'appelant — voir Task 4 — donc ici on suppose dimensions égales ; sinon `panic` testé séparément n'est pas requis.)

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src-tauri/src/bank/diff.rs` :

```rust
// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

use image::{ImageEncoder, RgbaImage};

pub struct DiffOutcome {
    pub changed_ratio: f32,
    pub bbox: Option<[u32; 4]>,
    pub diff_png: Vec<u8>,
}

pub fn diff_images(bank_png: &[u8], new_png: &[u8], tolerance: f64) -> Result<DiffOutcome, image::ImageError> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbaImage;

    fn png_bytes(img: &RgbaImage) -> Vec<u8> {
        let mut buf = Vec::new();
        image::codecs::png::PngEncoder::new(&mut buf)
            .write_image(img.as_raw(), img.width(), img.height(), image::ExtendedColorType::Rgba8)
            .unwrap();
        buf
    }

    #[test]
    fn identical_images_have_zero_ratio() {
        let img = RgbaImage::from_pixel(4, 4, image::Rgba([10, 20, 30, 255]));
        let out = diff_images(&png_bytes(&img), &png_bytes(&img), 0.1).unwrap();
        assert_eq!(out.changed_ratio, 0.0);
        assert!(out.bbox.is_none());
    }

    #[test]
    fn one_changed_pixel_is_detected_with_bbox() {
        let bank = RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 255]));
        let mut new = bank.clone();
        new.put_pixel(2, 1, image::Rgba([255, 255, 255, 255])); // blanc vs noir
        let out = diff_images(&png_bytes(&bank), &png_bytes(&new), 0.1).unwrap();
        assert!(out.changed_ratio > 0.0);
        assert_eq!(out.bbox, Some([2, 1, 1, 1]));
    }
}
```

Ajouter dans `src-tauri/src/bank/mod.rs` : `pub mod diff;`

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `cd src-tauri && cargo test bank::diff`
Expected: PANIC `not yet implemented`.

- [ ] **Step 3: Implémenter le diff YIQ**

Remplacer le corps de `diff_images` et ajouter les helpers :

```rust
pub fn diff_images(bank_png: &[u8], new_png: &[u8], tolerance: f64) -> Result<DiffOutcome, image::ImageError> {
    let bank = image::load_from_memory(bank_png)?.to_rgba8();
    let mut new = image::load_from_memory(new_png)?.to_rgba8();
    let (w, h) = (new.width(), new.height());

    // Seuil pixelmatch : delta max possible (noir↔blanc) = 35215.
    let max_delta = 35215.0 * tolerance * tolerance;

    let (mut min_x, mut min_y, mut max_x, mut max_y) = (u32::MAX, u32::MAX, 0u32, 0u32);
    let mut changed = 0u64;

    for y in 0..h {
        for x in 0..w {
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

    let total = (w as u64) * (h as u64);
    let changed_ratio = if total == 0 { 0.0 } else { changed as f32 / total as f32 };
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

    Ok(DiffOutcome { changed_ratio, bbox, diff_png })
}

fn color_delta(a: [u8; 4], b: [u8; 4]) -> f64 {
    let (ay, ai, aq) = yiq(a);
    let (by, bi, bq) = yiq(b);
    let (dy, di, dq) = (ay - by, ai - bi, aq - bq);
    0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq
}

fn yiq(p: [u8; 4]) -> (f64, f64, f64) {
    let (r, g, b) = (p[0] as f64, p[1] as f64, p[2] as f64);
    let y = r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
    let i = r * 0.59597799 - g * 0.27417610 - b * 0.32180189;
    let q = r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
    (y, i, q)
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `cd src-tauri && cargo test bank::diff`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/bank/diff.rs src-tauri/src/bank/mod.rs
git commit -m "feat(bank): YIQ pixelmatch diff core with bbox + diff png"
```

---

### Task 4: Orchestration de comparaison sur un flow (seed/match/changed/missing/dimension)

**Files:**
- Create: `src-tauri/src/bank/compare.rs`
- Modify: `src-tauri/src/bank/mod.rs` (ajouter `pub mod compare;` + ré-exports)

**Interfaces:**
- Consumes: `device_key`, `flow::screenshot_names`, `diff::diff_images`.
- Produces:
  ```rust
  #[derive(serde::Serialize, Clone)]
  #[serde(rename_all = "snake_case")]
  pub enum Status { Seeded, Match, Changed, Missing, DimensionMismatch }

  #[derive(serde::Serialize, Clone)]
  pub struct Comparison {
      pub name: String,
      pub status: Status,
      pub changed_ratio: f32,
      pub bbox: Option<[u32; 4]>,
      #[serde(skip_serializing_if = "Option::is_none")] pub bank_b64: Option<String>,
      #[serde(skip_serializing_if = "Option::is_none")] pub new_b64: Option<String>,
      #[serde(skip_serializing_if = "Option::is_none")] pub diff_b64: Option<String>,
  }

  pub struct CompareInput<'a> {
      pub workspace: &'a Path,
      pub flow_path: &'a Path,
      pub model: &'a str,
      pub width: u32,
      pub height: u32,
      pub tolerance: f64,
      pub threshold: f64,
  }

  pub fn compare_flow(input: CompareInput) -> std::io::Result<(String, Vec<Comparison>)>
  // renvoie (device_key, comparisons)
  ```
  Règles : pour chaque nom attendu (du flow), résoudre `<flow_dir>/<name>.png` (produit) et
  `<workspace>/maestro/bank/<key>/<name>.png` (référence).
  - produit absent → `Missing`.
  - produit présent, référence absente → copier le produit dans la banque → `Seeded`.
  - les deux présents, dimensions ≠ → `DimensionMismatch` (+ b64 bank/new).
  - les deux présents, `changed_ratio > threshold` → `Changed` (+ b64 bank/new/diff, bbox).
  - sinon → `Match`.
  Le `device_key` directory est créé au besoin (`create_dir_all`).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src-tauri/src/bank/compare.rs` avec l'en-tête licence, la déclaration des types ci-dessus,
un `pub fn compare_flow(...) -> ... { todo!() }`, et les tests :

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageEncoder, RgbaImage};
    use std::fs;

    fn write_png(path: &Path, img: &RgbaImage) {
        let mut buf = Vec::new();
        image::codecs::png::PngEncoder::new(&mut buf)
            .write_image(img.as_raw(), img.width(), img.height(), image::ExtendedColorType::Rgba8)
            .unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, buf).unwrap();
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mdbank_{tag}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn seeds_when_bank_empty_then_matches_next_run() {
        let ws = temp_dir("seed");
        let flow_dir = ws.join("flows");
        let flow_path = flow_dir.join("f.yaml");
        fs::create_dir_all(&flow_dir).unwrap();
        fs::write(&flow_path, "- takeScreenshot: home\n").unwrap();
        write_png(&flow_dir.join("home.png"), &RgbaImage::from_pixel(2, 2, image::Rgba([1, 2, 3, 255])));

        let input = CompareInput {
            workspace: &ws, flow_path: &flow_path, model: "Dev", width: 2, height: 2,
            tolerance: 0.1, threshold: 0.001,
        };
        let (key, comps) = compare_flow(input).unwrap();
        assert_eq!(comps.len(), 1);
        assert!(matches!(comps[0].status, Status::Seeded));
        // la référence existe maintenant
        assert!(ws.join("maestro/bank").join(&key).join("home.png").exists());

        // 2e run identique → Match
        let input2 = CompareInput {
            workspace: &ws, flow_path: &flow_path, model: "Dev", width: 2, height: 2,
            tolerance: 0.1, threshold: 0.001,
        };
        let (_, comps2) = compare_flow(input2).unwrap();
        assert!(matches!(comps2[0].status, Status::Match));
    }

    #[test]
    fn flags_changed_pixels() {
        let ws = temp_dir("changed");
        let flow_dir = ws.join("flows");
        let flow_path = flow_dir.join("f.yaml");
        fs::create_dir_all(&flow_dir).unwrap();
        fs::write(&flow_path, "- takeScreenshot: home\n").unwrap();
        let key = device_key("Dev", 4, 4);
        // référence noire
        write_png(&ws.join("maestro/bank").join(&key).join("home.png"),
                  &RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 255])));
        // produit avec un coin blanc
        let mut produced = RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 255]));
        produced.put_pixel(0, 0, image::Rgba([255, 255, 255, 255]));
        write_png(&flow_dir.join("home.png"), &produced);

        let (_, comps) = compare_flow(CompareInput {
            workspace: &ws, flow_path: &flow_path, model: "Dev", width: 4, height: 4,
            tolerance: 0.1, threshold: 0.001,
        }).unwrap();
        assert!(matches!(comps[0].status, Status::Changed));
        assert!(comps[0].diff_b64.is_some());
        assert_eq!(comps[0].bbox, Some([0, 0, 1, 1]));
    }

    #[test]
    fn missing_when_no_produced_file() {
        let ws = temp_dir("missing");
        let flow_dir = ws.join("flows");
        let flow_path = flow_dir.join("f.yaml");
        fs::create_dir_all(&flow_dir).unwrap();
        fs::write(&flow_path, "- takeScreenshot: home\n").unwrap();
        let (_, comps) = compare_flow(CompareInput {
            workspace: &ws, flow_path: &flow_path, model: "Dev", width: 2, height: 2,
            tolerance: 0.1, threshold: 0.001,
        }).unwrap();
        assert!(matches!(comps[0].status, Status::Missing));
    }
}
```

Ajouter dans `mod.rs` : `pub mod compare;`

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `cd src-tauri && cargo test bank::compare`
Expected: PANIC `not yet implemented`.

- [ ] **Step 3: Implémenter**

Corps de `compare.rs` (au-dessus des tests, après les types) :

```rust
use std::fs;
use std::path::Path;

use base64::Engine;

use crate::bank::device_key;
use crate::bank::diff::diff_images;
use crate::bank::flow::screenshot_names;

fn b64(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn dims(png: &[u8]) -> Option<(u32, u32)> {
    image::load_from_memory(png).ok().map(|i| (i.width(), i.height()))
}

pub fn compare_flow(input: CompareInput) -> std::io::Result<(String, Vec<Comparison>)> {
    let key = device_key(input.model, input.width, input.height);
    let bank_dir = input.workspace.join("maestro").join("bank").join(&key);
    fs::create_dir_all(&bank_dir)?;

    let flow_dir = input.flow_path.parent().unwrap_or(Path::new("."));
    let yaml = fs::read_to_string(input.flow_path).unwrap_or_default();
    let names = screenshot_names(&yaml);

    let mut comps = Vec::new();
    for name in names {
        let produced = flow_dir.join(format!("{name}.png"));
        let reference = bank_dir.join(format!("{name}.png"));

        if !produced.exists() {
            comps.push(Comparison {
                name, status: Status::Missing, changed_ratio: 0.0, bbox: None,
                bank_b64: None, new_b64: None, diff_b64: None,
            });
            continue;
        }
        let new_bytes = fs::read(&produced)?;

        if !reference.exists() {
            fs::copy(&produced, &reference)?;
            comps.push(Comparison {
                name, status: Status::Seeded, changed_ratio: 0.0, bbox: None,
                bank_b64: None, new_b64: None, diff_b64: None,
            });
            continue;
        }
        let bank_bytes = fs::read(&reference)?;

        if dims(&bank_bytes) != dims(&new_bytes) {
            comps.push(Comparison {
                name, status: Status::DimensionMismatch, changed_ratio: 0.0, bbox: None,
                bank_b64: Some(b64(&bank_bytes)), new_b64: Some(b64(&new_bytes)), diff_b64: None,
            });
            continue;
        }

        match diff_images(&bank_bytes, &new_bytes, input.tolerance) {
            Ok(out) if out.changed_ratio as f64 > input.threshold => comps.push(Comparison {
                name,
                status: Status::Changed,
                changed_ratio: out.changed_ratio,
                bbox: out.bbox,
                bank_b64: Some(b64(&bank_bytes)),
                new_b64: Some(b64(&new_bytes)),
                diff_b64: Some(b64(&out.diff_png)),
            }),
            Ok(out) => comps.push(Comparison {
                name, status: Status::Match, changed_ratio: out.changed_ratio, bbox: None,
                bank_b64: None, new_b64: None, diff_b64: None,
            }),
            Err(_) => comps.push(Comparison {
                name, status: Status::Missing, changed_ratio: 0.0, bbox: None,
                bank_b64: None, new_b64: None, diff_b64: None,
            }),
        }
    }
    Ok((key, comps))
}
```

Ajouter la dépendance `base64` si absente de `src-tauri/Cargo.toml` (vérifier d'abord — déjà utilisée ailleurs dans le projet pour l'encodage PNG ; si présente, ne rien faire) :

```toml
base64 = "0.22"
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `cd src-tauri && cargo test bank::compare`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/bank/compare.rs src-tauri/src/bank/mod.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(bank): compare_flow orchestration (seed/match/changed/missing/dimension)"
```

---

### Task 5: Commandes Tauri `compare_screenshots` + `resolve_comparison`

**Files:**
- Create: `src-tauri/src/bank/ipc.rs`
- Modify: `src-tauri/src/bank/mod.rs` (`pub mod ipc;`)
- Modify: `src-tauri/src/lib.rs` (enregistrer les 2 commandes dans `generate_handler!`)

**Interfaces:**
- Consumes: `compare::{compare_flow, CompareInput, Comparison}`.
- Produces (commandes Tauri) :
  ```rust
  #[tauri::command]
  pub async fn compare_screenshots(
      workspace: String, flow_path: String, model: String,
      width: u32, height: u32, tolerance: f64, threshold: f64, run_id: String,
  ) -> Result<RunReport, String>

  #[tauri::command]
  pub async fn resolve_comparison(
      workspace: String, run_id: String, device_key: String, name: String, decision: String,
  ) -> Result<(), String>
  ```
  `RunReport { run_id, device_key, comparisons }` (le front lira `run_id`/`device_key`/`comparisons`). `compare_screenshots` copie d'abord chaque PNG produit (à côté du flow) dans `<workspace>/maestro/.runs/<run_id>/`, lance `compare_flow`, puis écrit un `report.json` *slim* (sans b64) dans ce même dossier.
  `resolve_comparison` : `decision == "replace"` → copie `.runs/<run_id>/<name>.png` → `bank/<device_key>/<name>.png` (écrase la référence). `decision == "keep"` → no-op (banque inchangée, régression déjà tracée).

- [ ] **Step 1: Écrire le test qui échoue (résolution `replace`)**

Créer `src-tauri/src/bank/ipc.rs` avec en-tête licence, types + commandes en `todo!()`, et un test
unitaire sur la fonction pure de remplacement (la logique testable hors Tauri) :

```rust
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
pub fn replace_bank_image(workspace: &Path, run_id: &str, device_key: &str, name: &str) -> std::io::Result<()> {
    todo!()
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
```

Ajouter `pub mod ipc;` dans `mod.rs`.

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `cd src-tauri && cargo test bank::ipc`
Expected: PANIC `not yet implemented`.

- [ ] **Step 3: Implémenter les commandes + helper**

Dans `ipc.rs`, implémenter `replace_bank_image` et les deux commandes. `compare_screenshots`
copie chaque PNG produit (à côté du flow) dans le dossier de run **avant** de comparer, pour que
`resolve replace` ait une source stable ; il écrit aussi le `report.json` slim.

```rust
pub fn replace_bank_image(workspace: &Path, run_id: &str, device_key: &str, name: &str) -> std::io::Result<()> {
    let src = workspace.join("maestro").join(".runs").join(run_id).join(format!("{name}.png"));
    let dst = workspace.join("maestro").join("bank").join(device_key).join(format!("{name}.png"));
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
    let report = serde_json::json!({ "run_id": run_id, "device_key": device_key, "comparisons": slim });
    let _ = fs::write(run_dir.join("report.json"), serde_json::to_vec_pretty(&report).unwrap_or_default());

    Ok(RunReport { run_id, device_key, comparisons })
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
        // "replace" : la nouvelle capture (copiée dans le dossier de run) devient la vérité.
        replace_bank_image(Path::new(&workspace), &run_id, &device_key, &name)
            .map_err(|e| e.to_string())?;
    }
    // "keep" : régression confirmée, banque inchangée (déjà tracée dans report.json).
    Ok(())
}
```

- [ ] **Step 4: Enregistrer les commandes**

Dans `src-tauri/src/lib.rs`, ajouter dans `tauri::generate_handler![ ... ]` (après `stop_flow,`) :

```rust
        bank::ipc::compare_screenshots,
        bank::ipc::resolve_comparison,
```

- [ ] **Step 5: Lancer test + build, vérifier le succès**

Run: `cd src-tauri && cargo test bank::ipc && cargo build`
Expected: tests PASS, build OK (commandes enregistrées sans erreur de macro).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/bank/ipc.rs src-tauri/src/bank/mod.rs src-tauri/src/lib.rs
git commit -m "feat(bank): compare_screenshots + resolve_comparison tauri commands"
```

---

### Task 6: CWD du runner = dossier du flow

**Files:**
- Modify: `src-tauri/src/runner/mod.rs` (4 sites `Command::new(...)` : lignes ~126, ~212, ~291, ~426)

**Interfaces:**
- Aucune nouvelle interface publique ; comportement : les `takeScreenshot` de Maestro écrivent
  `<nom>.png` dans le dossier du fichier flow.

- [ ] **Step 1: Insérer `.current_dir(...)` dans `spawn_runner`**

Avant le `.spawn()` de la commande maestro (après le dernier `.arg(flow_path)` / `.args(&env_args)`,
juste avant `.stdout(Stdio::piped())`), insérer (calculer le dossier parent une fois en haut de la fn) :

```rust
let flow_dir = std::path::Path::new(flow_path)
    .parent()
    .map(|p| p.to_path_buf())
    .unwrap_or_else(|| std::path::PathBuf::from("."));
```

puis sur la chaîne `Command::new(&bin)` ajouter `.current_dir(&flow_dir)` :

```rust
let mut child = Command::new(&bin)
    .no_window()
    .args(["--udid", serial, "test"])
    .args(&env_args)
    .arg(flow_path)
    .current_dir(&flow_dir)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true)
    .spawn()
```

- [ ] **Step 2: Répéter pour les 3 autres runners**

Appliquer la même `flow_dir` + `.current_dir(&flow_dir)` dans `spawn_web_runner` (~212),
`spawn_ios_runner` (~291), `spawn_ios_device_runner` (~426). (Le binaire maestro reçoit `flow_path`
en chemin relatif/absolu inchangé — un chemin absolu reste valide quel que soit le CWD.)

- [ ] **Step 3: Vérifier la compilation**

Run: `cd src-tauri && cargo build`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/runner/mod.rs
git commit -m "feat(runner): set CWD to flow directory so takeScreenshot lands next to flow"
```

---

### Task 7: Store de réglages `visualRegressionStore`

**Files:**
- Create: `src/stores/visualRegressionStore.ts`
- Create: `src/stores/visualRegressionStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DEFAULT_TOLERANCE = 0.1;
  export const DEFAULT_THRESHOLD = 0.001;
  export interface VisualRegressionState {
    tolerance: number | null;   // null → défaut
    threshold: number | null;   // null → défaut
    setTolerance: (v: number | null) => void;
    setThreshold: (v: number | null) => void;
    reset: () => void;
  }
  export const useVisualRegressionStore = create<VisualRegressionState>()(...);
  export function effectiveThresholds(): { tolerance: number; threshold: number };
  ```

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/stores/visualRegressionStore.test.ts` :

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  useVisualRegressionStore,
  effectiveThresholds,
  DEFAULT_TOLERANCE,
  DEFAULT_THRESHOLD,
} from "@/stores/visualRegressionStore";

describe("visualRegressionStore", () => {
  beforeEach(() => useVisualRegressionStore.getState().reset());

  it("returns defaults when unset", () => {
    expect(effectiveThresholds()).toEqual({
      tolerance: DEFAULT_TOLERANCE,
      threshold: DEFAULT_THRESHOLD,
    });
  });

  it("uses custom values when set", () => {
    useVisualRegressionStore.getState().setTolerance(0.2);
    useVisualRegressionStore.getState().setThreshold(0.05);
    expect(effectiveThresholds()).toEqual({ tolerance: 0.2, threshold: 0.05 });
  });
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `pnpm test src/stores/visualRegressionStore.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter le store (calqué sur `billyPromptStore.ts`)**

Créer `src/stores/visualRegressionStore.ts` :

```ts
// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const DEFAULT_TOLERANCE = 0.1;
export const DEFAULT_THRESHOLD = 0.001;

export interface VisualRegressionState {
  tolerance: number | null;
  threshold: number | null;
  setTolerance: (v: number | null) => void;
  setThreshold: (v: number | null) => void;
  reset: () => void;
}

export const useVisualRegressionStore = create<VisualRegressionState>()(
  persist(
    (set) => ({
      tolerance: null,
      threshold: null,
      setTolerance: (v) => set({ tolerance: v }),
      setThreshold: (v) => set({ threshold: v }),
      reset: () => set({ tolerance: null, threshold: null }),
    }),
    {
      name: "maestro-deck.visual-regression",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function effectiveThresholds(): { tolerance: number; threshold: number } {
  const { tolerance, threshold } = useVisualRegressionStore.getState();
  return {
    tolerance: tolerance ?? DEFAULT_TOLERANCE,
    threshold: threshold ?? DEFAULT_THRESHOLD,
  };
}
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `pnpm test src/stores/visualRegressionStore.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/visualRegressionStore.ts src/stores/visualRegressionStore.test.ts
git commit -m "feat(settings): visual regression thresholds store"
```

---

### Task 8: Bindings IPC front + types

**Files:**
- Modify: `src/lib/ipc.ts` (ajouter `compareScreenshots`, `resolveComparison` dans `ipc`)
- Create: `src/types/visualRegression.ts`

**Interfaces:**
- Consumes: commandes Rust `compare_screenshots`, `resolve_comparison`.
- Produces:
  ```ts
  // src/types/visualRegression.ts
  export type ComparisonStatus = "seeded" | "match" | "changed" | "missing" | "dimension_mismatch";
  export interface Comparison {
    name: string;
    status: ComparisonStatus;
    changed_ratio: number;
    bbox: [number, number, number, number] | null;
    bank_b64?: string;
    new_b64?: string;
    diff_b64?: string;
  }
  export interface RunReport {
    run_id: string;
    device_key: string;
    comparisons: Comparison[];
  }

  // ajoutés à l'objet `ipc` :
  compareScreenshots(args: {
    workspace: string; flowPath: string; model: string; width: number; height: number;
    tolerance: number; threshold: number; runId: string;
  }): Promise<RunReport>;
  resolveComparison(args: {
    workspace: string; runId: string; deviceKey: string; name: string; decision: "keep" | "replace";
  }): Promise<void>;
  ```

- [ ] **Step 1: Créer les types**

Créer `src/types/visualRegression.ts` avec l'en-tête licence et les types ci-dessus
(`ComparisonStatus`, `Comparison`, `RunReport`).

- [ ] **Step 2: Ajouter les bindings dans `src/lib/ipc.ts`**

Importer les types en haut du fichier :

```ts
import type { RunReport } from "@/types/visualRegression";
```

Dans l'objet `ipc` (à côté de `runFlow`/`stopFlow`), ajouter — les clés d'argument correspondent
aux noms de paramètres Rust (Tauri convertit camelCase→snake_case automatiquement) :

```ts
  compareScreenshots: (args: {
    workspace: string; flowPath: string; model: string; width: number; height: number;
    tolerance: number; threshold: number; runId: string;
  }) => call<RunReport>("compare_screenshots", args),
  resolveComparison: (args: {
    workspace: string; runId: string; deviceKey: string; name: string; decision: "keep" | "replace";
  }) => call<void>("resolve_comparison", args),
```

- [ ] **Step 3: Vérifier le typecheck**

Run: `pnpm typecheck`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ipc.ts src/types/visualRegression.ts
git commit -m "feat(ipc): bindings + types for screenshot comparison"
```

---

### Task 9: Section Paramètres « Régression visuelle »

**Files:**
- Create: `src/components/settings/VisualRegressionSettings.tsx`
- Modify: `src/components/settings/sections.tsx` (ajouter l'entrée + import)

**Interfaces:**
- Consumes: `useVisualRegressionStore`, `DEFAULT_TOLERANCE`, `DEFAULT_THRESHOLD`, `SettingsSection`.

- [ ] **Step 1: Créer le composant (calqué sur `BillySettings.tsx`)**

Créer `src/components/settings/VisualRegressionSettings.tsx` :

```tsx
// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/settings/SettingsPrimitives";
import {
  useVisualRegressionStore,
  DEFAULT_TOLERANCE,
  DEFAULT_THRESHOLD,
} from "@/stores/visualRegressionStore";

export function VisualRegressionSettings() {
  const tolerance = useVisualRegressionStore((s) => s.tolerance);
  const threshold = useVisualRegressionStore((s) => s.threshold);
  const setTolerance = useVisualRegressionStore((s) => s.setTolerance);
  const setThreshold = useVisualRegressionStore((s) => s.setThreshold);
  const reset = useVisualRegressionStore((s) => s.reset);

  const isCustomized = tolerance !== null || threshold !== null;

  return (
    <SettingsSection
      title="Régression visuelle"
      description="Seuils de comparaison des screenshots de la banque. La tolérance contrôle la sensibilité par pixel (échelle pixelmatch). Le seuil est la part de pixels modifiés au-delà de laquelle un screenshot est signalé."
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span>Tolérance par pixel (défaut {DEFAULT_TOLERANCE})</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={tolerance ?? DEFAULT_TOLERANCE}
            onChange={(e) =>
              setTolerance(e.target.value === "" ? null : Number(e.target.value))
            }
            className="w-32 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>Seuil de pixels changés (défaut {DEFAULT_THRESHOLD})</span>
          <input
            type="number"
            step="0.001"
            min="0"
            max="1"
            value={threshold ?? DEFAULT_THRESHOLD}
            onChange={(e) =>
              setThreshold(e.target.value === "" ? null : Number(e.target.value))
            }
            className="w-32 rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
          />
        </label>
        <div>
          <Button size="sm" variant="outline" onClick={reset} disabled={!isCustomized}>
            Réinitialiser
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
```

- [ ] **Step 2: Enregistrer la section**

Dans `src/components/settings/sections.tsx`, importer en haut :

```tsx
import { VisualRegressionSettings } from "@/components/settings/VisualRegressionSettings";
```

et ajouter dans `SETTINGS_SECTIONS` (avant `about`) :

```tsx
  { id: "visual-regression", label: "Régression visuelle", render: () => <VisualRegressionSettings /> },
```

- [ ] **Step 3: Vérifier typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/VisualRegressionSettings.tsx src/components/settings/sections.tsx
git commit -m "feat(settings): visual regression thresholds section"
```

---

### Task 10: Store de revue + orchestration post-run

**Files:**
- Create: `src/stores/reviewStore.ts`
- Modify: `src/App.tsx` (handler `onRunnerExit`, lignes ~131-141 ; et accès au flow courant)

**Interfaces:**
- Consumes: `ipc.compareScreenshots`, `effectiveThresholds`, `RunReport`, stores workspace/device, chemin du flow courant.
- Produces:
  ```ts
  export interface ReviewState {
    report: RunReport | null;
    queue: string[];          // noms des comparaisons à revoir (status changed/dimension_mismatch)
    open: boolean;
    setReport: (r: RunReport | null) => void;
    next: () => void;         // retire la tête de queue ; ferme si vide
    close: () => void;
  }
  export const useReviewStore = create<ReviewState>()(...);
  ```

- [ ] **Step 1: Créer le store de revue**

Créer `src/stores/reviewStore.ts` :

```ts
// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import type { RunReport } from "@/types/visualRegression";

const REVIEWABLE = new Set(["changed", "dimension_mismatch"]);

export interface ReviewState {
  report: RunReport | null;
  queue: string[];
  open: boolean;
  setReport: (r: RunReport | null) => void;
  next: () => void;
  close: () => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  report: null,
  queue: [],
  open: false,
  setReport: (r) => {
    const queue = r ? r.comparisons.filter((c) => REVIEWABLE.has(c.status)).map((c) => c.name) : [];
    set({ report: r, queue, open: queue.length > 0 });
  },
  next: () => {
    const queue = get().queue.slice(1);
    set({ queue, open: queue.length > 0 });
  },
  close: () => set({ open: false, queue: [] }),
}));
```

- [ ] **Step 2: Identifier le flow courant dans `App.tsx`**

Repérer comment `onRun` connaît le fichier de flow lancé (probablement via `runStore`/`workspaceStore`,
ex. `useWorkspaceStore.getState().lastOpenFile`). Utiliser ce chemin comme `flowPath`. Si plusieurs
flows (Run All), le handler s'exécute pour le flow effectivement lancé — réutiliser la même source que
`ipc.runFlow(filePath, ...)`.

- [ ] **Step 3: Brancher la comparaison sur `onRunnerExit`**

Dans `src/App.tsx`, dans le handler `events.onRunnerExit(({ code }) => { ... })`, après `setStopped(code)`,
ajouter (n'agir que si succès et contexte disponible) :

```ts
        if (code === 0) {
          const ws = useWorkspaceStore.getState().folderPath;
          const device = useDeviceStore.getState().current;
          const flowPath = useWorkspaceStore.getState().lastOpenFile; // même source que runFlow
          if (ws && device && flowPath) {
            const { tolerance, threshold } = effectiveThresholds();
            const runId = String(useRunStore.getState().pid ?? Date.now());
            ipc
              .compareScreenshots({
                workspace: ws,
                flowPath,
                model: device.model,
                width: device.screen_width,
                height: device.screen_height,
                tolerance,
                threshold,
                runId,
              })
              .then((report) => useReviewStore.getState().setReport(report))
              .catch((err) => console.error("compare_screenshots failed", err));
          }
        }
```

Ajouter les imports nécessaires en haut de `App.tsx` :

```ts
import { useReviewStore } from "@/stores/reviewStore";
import { effectiveThresholds } from "@/stores/visualRegressionStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useDeviceStore } from "@/stores/deviceStore";
// `ipc`, `useRunStore` sont déjà importés ; sinon les ajouter.
```

> `runId` = PID du run (déjà unique et présent dans `runStore`). À défaut, `Date.now()`.

- [ ] **Step 4: Vérifier typecheck**

Run: `pnpm typecheck`
Expected: aucune erreur.

- [ ] **Step 5: Commit**

```bash
git add src/stores/reviewStore.ts src/App.tsx
git commit -m "feat(review): trigger comparison on successful run, queue reviewable diffs"
```

---

### Task 11: Modale de revue `ScreenshotReview`

**Files:**
- Create: `src/components/ScreenshotReview.tsx`
- Modify: `src/components/MainView.tsx` (monter `<ScreenshotReview />` à côté de `RunConsole`, ~ligne 296)

**Interfaces:**
- Consumes: `useReviewStore`, `ipc.resolveComparison`, `useWorkspaceStore`, `Comparison`.
- Produces: composant sans props `export function ScreenshotReview()`.

- [ ] **Step 1: Créer la modale**

Créer `src/components/ScreenshotReview.tsx`. Affiche la comparaison en tête de `queue` :
gauche = banque (`bank_b64`), droite = nouvelle (`new_b64`) avec la bbox encadrée ; toggle overlay diff
(`diff_b64`). Deux actions appellent `resolveComparison` puis `next()`.

```tsx
// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { ipc } from "@/lib/ipc";
import { useReviewStore } from "@/stores/reviewStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

export function ScreenshotReview() {
  const open = useReviewStore((s) => s.open);
  const report = useReviewStore((s) => s.report);
  const queue = useReviewStore((s) => s.queue);
  const next = useReviewStore((s) => s.next);
  const [showDiff, setShowDiff] = useState(true); // overlay diff visible par défaut

  if (!open || !report || queue.length === 0) return null;
  const name = queue[0];
  const comp = report.comparisons.find((c) => c.name === name);
  if (!comp) return null;

  const workspace = useWorkspaceStore.getState().folderPath ?? "";

  const decide = async (decision: "keep" | "replace") => {
    try {
      await ipc.resolveComparison({
        workspace,
        runId: report.run_id,
        deviceKey: report.device_key,
        name,
        decision,
      });
    } catch (err) {
      console.error("resolve_comparison failed", err);
    } finally {
      setShowDiff(false);
      next();
    }
  };

  const bbox = comp.bbox;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex max-h-[90vh] w-[90vw] max-w-5xl flex-col gap-3 rounded-lg bg-white p-4 shadow-xl dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Régression visuelle — « {name} » ({queue.length} restant{queue.length > 1 ? "s" : ""})
          </h2>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} />
            Overlay diff
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 overflow-auto">
          <figure className="flex flex-col items-center gap-1">
            <figcaption className="text-xs text-neutral-500">Banque (référence)</figcaption>
            <img src={comp.bank_b64} alt="banque" className="max-h-[70vh] object-contain" />
          </figure>
          <figure className="flex flex-col items-center gap-1">
            <figcaption className="text-xs text-neutral-500">
              Nouvelle capture {bbox ? "(zone changée en rouge via l'overlay)" : ""}
            </figcaption>
            <img
              src={showDiff ? comp.diff_b64 ?? comp.new_b64 : comp.new_b64}
              alt="nouvelle"
              className="max-h-[70vh] object-contain"
            />
          </figure>
        </div>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => void decide("keep")}>
            Garder la banque (régression)
          </Button>
          <Button size="sm" onClick={() => void decide("replace")}>
            Remplacer par la nouvelle
          </Button>
        </div>
      </div>
    </div>
  );
}
```

> Localisation du changement : en v1, l'**overlay diff** (pixels rouges, visible par défaut) est le
> moyen visuel principal de repérer la zone qui a varié — robuste quel que soit le scaling
> `object-contain`. La `bbox` est conservée dans le rapport (utile pour une v2 qui dessinerait un
> encadré à l'échelle), mais pas rendue comme rectangle superposé en v1.

- [ ] **Step 2: Monter la modale**

Dans `src/components/MainView.tsx`, près du `<RunConsole .../>` (~ligne 296), ajouter en frère :

```tsx
<ScreenshotReview />
```

et l'import en haut :

```tsx
import { ScreenshotReview } from "@/components/ScreenshotReview";
```

- [ ] **Step 3: Vérifier typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: aucune erreur ; tests existants + nouveaux PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/ScreenshotReview.tsx src/components/MainView.tsx
git commit -m "feat(review): screenshot comparison review modal (keep/replace)"
```

---

## Vérification finale (manuelle, après toutes les tâches)

- [ ] `cd src-tauri && cargo test` → tous les tests `bank::*` PASS.
- [ ] `pnpm test && pnpm typecheck && pnpm lint` → OK.
- [ ] `pnpm tauri:dev` : ouvrir un workspace, connecter un device, lancer un flow contenant
  `takeScreenshot: <nom>`.
  - 1er run (banque vide) → aucune modale ; `<workspace>/maestro/bank/<key>/<nom>.png` créé.
  - Modifier l'app pour provoquer un changement visuel, relancer → modale de revue s'ouvre
    (gauche banque / droite nouvelle + overlay diff).
  - « Remplacer » → `bank/<key>/<nom>.png` mis à jour. « Garder » → banque inchangée.
  - Run en échec (exit ≠ 0) → aucune modale, aucune écriture banque.
- [ ] Paramètres → section « Régression visuelle » : modifier les seuils, vérifier la persistance
  (recharger l'app), « Réinitialiser » revient aux défauts.
```
