// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

use std::fs;
use std::path::Path;

use base64::Engine;

use crate::bank::device_key;
use crate::bank::diff::diff_images;
use crate::bank::flow::screenshot_names;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Seeded,
    Match,
    Changed,
    Missing,
    DimensionMismatch,
}

#[derive(serde::Serialize, Clone)]
pub struct Comparison {
    pub name: String,
    pub status: Status,
    pub changed_ratio: f32,
    pub bbox: Option<[u32; 4]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bank_b64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_b64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_b64: Option<String>,
}

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

fn b64(bytes: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn dims(png: &[u8]) -> Option<(u32, u32)> {
    image::load_from_memory(png)
        .ok()
        .map(|i| (i.width(), i.height()))
}

pub fn compare_flow(input: CompareInput) -> std::io::Result<(String, Vec<Comparison>)> {
    let key = device_key(input.model, input.width, input.height);
    let bank_dir = input.workspace.join("maestro").join("bank").join(&key);
    fs::create_dir_all(&bank_dir)?;

    let flow_dir = input.flow_path.parent().unwrap_or(Path::new("."));
    let yaml = fs::read_to_string(input.flow_path).unwrap_or_default();
    let names = screenshot_names(&yaml);
    let mask_ratio = crate::bank::status_bar_ratio(input.platform, input.ignore_status_bar);

    let mut comps = Vec::new();
    for name in names {
        let produced = flow_dir.join(format!("{name}.png"));
        let reference = bank_dir.join(format!("{name}.png"));

        if !produced.exists() {
            comps.push(Comparison {
                name,
                status: Status::Missing,
                changed_ratio: 0.0,
                bbox: None,
                bank_b64: None,
                new_b64: None,
                diff_b64: None,
            });
            continue;
        }
        let new_bytes = fs::read(&produced)?;

        if !reference.exists() {
            fs::copy(&produced, &reference)?;
            comps.push(Comparison {
                name,
                status: Status::Seeded,
                changed_ratio: 0.0,
                bbox: None,
                bank_b64: None,
                new_b64: None,
                diff_b64: None,
            });
            continue;
        }
        let bank_bytes = fs::read(&reference)?;

        if dims(&bank_bytes) != dims(&new_bytes) {
            comps.push(Comparison {
                name,
                status: Status::DimensionMismatch,
                changed_ratio: 0.0,
                bbox: None,
                bank_b64: Some(b64(&bank_bytes)),
                new_b64: Some(b64(&new_bytes)),
                diff_b64: None,
            });
            continue;
        }

        match diff_images(&bank_bytes, &new_bytes, input.tolerance, mask_ratio) {
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
                name,
                status: Status::Match,
                changed_ratio: out.changed_ratio,
                bbox: None,
                bank_b64: None,
                new_b64: None,
                diff_b64: None,
            }),
            Err(_) => comps.push(Comparison {
                name,
                status: Status::Missing,
                changed_ratio: 0.0,
                bbox: None,
                bank_b64: None,
                new_b64: None,
                diff_b64: None,
            }),
        }
    }
    Ok((key, comps))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageEncoder, RgbaImage};
    use std::fs;

    fn write_png(path: &Path, img: &RgbaImage) {
        let mut buf = Vec::new();
        image::codecs::png::PngEncoder::new(&mut buf)
            .write_image(
                img.as_raw(),
                img.width(),
                img.height(),
                image::ExtendedColorType::Rgba8,
            )
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
        write_png(
            &flow_dir.join("home.png"),
            &RgbaImage::from_pixel(2, 2, image::Rgba([1, 2, 3, 255])),
        );

        let input = CompareInput {
            workspace: &ws,
            flow_path: &flow_path,
            model: "Dev",
            width: 2,
            height: 2,
            tolerance: 0.1,
            threshold: 0.001,
            platform: "android",
            ignore_status_bar: false,
        };
        let (key, comps) = compare_flow(input).unwrap();
        assert_eq!(comps.len(), 1);
        assert!(matches!(comps[0].status, Status::Seeded));
        // la référence existe maintenant
        assert!(ws.join("maestro/bank").join(&key).join("home.png").exists());

        // 2e run identique → Match
        let input2 = CompareInput {
            workspace: &ws,
            flow_path: &flow_path,
            model: "Dev",
            width: 2,
            height: 2,
            tolerance: 0.1,
            threshold: 0.001,
            platform: "android",
            ignore_status_bar: false,
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
        write_png(
            &ws.join("maestro/bank").join(&key).join("home.png"),
            &RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 255])),
        );
        // produit avec un coin blanc
        let mut produced = RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 255]));
        produced.put_pixel(0, 0, image::Rgba([255, 255, 255, 255]));
        write_png(&flow_dir.join("home.png"), &produced);

        let (_, comps) = compare_flow(CompareInput {
            workspace: &ws,
            flow_path: &flow_path,
            model: "Dev",
            width: 4,
            height: 4,
            tolerance: 0.1,
            threshold: 0.001,
            platform: "android",
            ignore_status_bar: false,
        })
        .unwrap();
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
            workspace: &ws,
            flow_path: &flow_path,
            model: "Dev",
            width: 2,
            height: 2,
            tolerance: 0.1,
            threshold: 0.001,
            platform: "android",
            ignore_status_bar: false,
        })
        .unwrap();
        assert!(matches!(comps[0].status, Status::Missing));
    }

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
}
