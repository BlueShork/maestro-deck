// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! R4 — RAAM 2.2: text contrast, estimated from the screenshot.
//!
//! Maestro doesn't expose colours, so we read the pixels under each text
//! element: the most frequent colour is taken as the background, and the
//! colour with the highest contrast against it (among colours covering a
//! meaningful share of the box) as the text. On a busy background (image,
//! gradient) the estimate is unreliable, so a low ratio is reported as "à
//! vérifier" instead of a failure.

use std::collections::HashMap;

use image::RgbaImage;

use super::{app_nodes, finding, screen_bounds, AuditConfig, RuleOutcome, Screen};
use crate::hierarchy::Bounds;

/// WCAG relative luminance of an sRGB colour.
pub fn luminance(rgb: [u8; 3]) -> f64 {
    let lin = |c: u8| {
        let c = c as f64 / 255.0;
        if c <= 0.039_28 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
}

/// WCAG contrast ratio, 1.0 – 21.0.
pub fn contrast_ratio(a: [u8; 3], b: [u8; 3]) -> f64 {
    let (la, lb) = (luminance(a), luminance(b));
    let (hi, lo) = if la > lb { (la, lb) } else { (lb, la) };
    (hi + 0.05) / (lo + 0.05)
}

/// Estimated colours inside a text box.
#[derive(Debug, Clone, Copy)]
pub struct Estimate {
    pub background: [u8; 3],
    pub foreground: [u8; 3],
    /// Share of the box covered by the background colour (0–1).
    pub background_share: f64,
}

/// Minimum share of the box a colour must cover to count as the text colour.
const MIN_FG_SHARE: f64 = 0.02;
/// Below this background share the background isn't uniform enough to trust.
const UNIFORM_BG_SHARE: f64 = 0.5;

pub fn estimate(img: &RgbaImage, b: &Bounds) -> Option<Estimate> {
    let (w, h) = img.dimensions();
    let x0 = b.left.max(0) as u32;
    let y0 = b.top.max(0) as u32;
    let x1 = (b.right.max(0) as u32).min(w);
    let y1 = (b.bottom.max(0) as u32).min(h);
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    // Sample at most ~40k pixels.
    let area = ((x1 - x0) * (y1 - y0)) as f64;
    let step = ((area / 40_000.0).sqrt().ceil() as u32).max(1);

    // Bucket by 5 bits per channel, keep the true average per bucket.
    let mut buckets: HashMap<(u8, u8, u8), (u64, [u64; 3])> = HashMap::new();
    let mut total = 0u64;
    let mut y = y0;
    while y < y1 {
        let mut x = x0;
        while x < x1 {
            let p = img.get_pixel(x, y).0;
            let e = buckets
                .entry((p[0] >> 3, p[1] >> 3, p[2] >> 3))
                .or_insert((0, [0; 3]));
            e.0 += 1;
            for (sum, c) in e.1.iter_mut().zip(p) {
                *sum += c as u64;
            }
            total += 1;
            x += step;
        }
        y += step;
    }
    let avg = |(n, s): &(u64, [u64; 3])| [(s[0] / n) as u8, (s[1] / n) as u8, (s[2] / n) as u8];

    let bg = buckets.values().max_by_key(|(n, _)| *n)?;
    let background = avg(bg);
    let fg = buckets
        .values()
        .filter(|(n, _)| *n as f64 / total as f64 >= MIN_FG_SHARE)
        .map(avg)
        .max_by(|a, b| {
            contrast_ratio(*a, background)
                .partial_cmp(&contrast_ratio(*b, background))
                .unwrap_or(std::cmp::Ordering::Equal)
        })?;
    if fg == background {
        return None; // no visible text pixels
    }
    Some(Estimate {
        background,
        foreground: fg,
        background_share: bg.0 as f64 / total as f64,
    })
}

/// Hierarchy coordinates are device pixels; the screenshot may have been
/// downscaled. Map the bounds onto the image.
fn scale_bounds(b: &Bounds, root: &Bounds, img: &RgbaImage) -> Bounds {
    let rw = (root.right - root.left).max(1) as f64;
    let rh = (root.bottom - root.top).max(1) as f64;
    let sx = img.width() as f64 / rw;
    let sy = img.height() as f64 / rh;
    Bounds {
        left: (b.left as f64 * sx).round() as i32,
        top: (b.top as f64 * sy).round() as i32,
        right: (b.right as f64 * sx).round() as i32,
        bottom: (b.bottom as f64 * sy).round() as i32,
    }
}

fn hex(c: [u8; 3]) -> String {
    format!("#{:02X}{:02X}{:02X}", c[0], c[1], c[2])
}

pub fn text_contrast(screen: &Screen, config: &AuditConfig) -> RuleOutcome {
    let mut out = RuleOutcome::default();
    let Some(img) = screen.screenshot.as_ref() else {
        return out;
    };
    let density = config.density(&screen.root);
    for n in app_nodes(&screen.root) {
        if n.text.as_deref().map(str::trim).unwrap_or("").is_empty() {
            continue;
        }
        // Text lives in leaf elements. A container carrying a label (iOS
        // `Application « Réglages »`, a whole row) spans other content, so
        // its pixels say nothing about the text colour.
        if !n.children.is_empty() {
            continue;
        }
        // On iOS the VoiceOver label is folded into `text` for every element
        // (icons, switches, cells), so only StaticText is visible text.
        if config.platform == super::Platform::Ios && n.class_name != "StaticText" {
            continue;
        }
        let b = scale_bounds(&n.bounds, &screen_bounds(&screen.root), img);
        let Some(est) = estimate(img, &b) else {
            continue;
        };
        out.applicable = true;
        // Box height as a proxy for font size: ≥ 32 dp ≈ 18 pt text plus
        // padding, WCAG's "large text" threshold.
        let height_units = (n.bounds.bottom - n.bounds.top) as f32 / density;
        let large = height_units >= 32.0;
        let required = if large { 3.0 } else { 4.5 };
        let ratio = contrast_ratio(est.foreground, est.background);
        if ratio + 1e-9 < required {
            let mut f = finding(
                screen,
                n,
                format!(
                    "Contraste estimé {ratio:.2}:1 (texte {} sur {}), minimum {required}:1",
                    hex(est.foreground),
                    hex(est.background)
                ),
            );
            f.needs_review = est.background_share < UNIFORM_BG_SHARE;
            out.findings.push(f);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::testutil::*;
    use super::*;
    use image::Rgba;

    #[test]
    fn ratio_matches_wcag_reference_values() {
        assert!((contrast_ratio([0, 0, 0], [255, 255, 255]) - 21.0).abs() < 0.01);
        assert!((contrast_ratio([255, 255, 255], [255, 255, 255]) - 1.0).abs() < 1e-9);
        // #777 on white ≈ 4.48:1, the classic "just fails AA" grey.
        let r = contrast_ratio([0x77, 0x77, 0x77], [255, 255, 255]);
        assert!(r > 4.4 && r < 4.5, "{r}");
    }

    /// Paints a "text" stripe of `fg` on a `bg` box.
    fn image_with_text(bg: [u8; 3], fg: [u8; 3]) -> RgbaImage {
        let mut img = RgbaImage::from_pixel(1080, 2400, Rgba([bg[0], bg[1], bg[2], 255]));
        for y in 140..160 {
            for x in 120..600 {
                img.put_pixel(x, y, Rgba([fg[0], fg[1], fg[2], 255]));
            }
        }
        img
    }

    fn text_screen(img: RgbaImage) -> Screen {
        let mut t = node("android.widget.TextView", [100, 100, 700, 200]);
        t.text = Some("Bonjour".into());
        let mut s = screen(root(vec![t]));
        s.screenshot = Some(img);
        s
    }

    #[test]
    fn dark_text_on_white_passes() {
        let o = text_contrast(&text_screen(image_with_text([255; 3], [20; 3])), &android());
        assert!(o.applicable);
        assert!(o.findings.is_empty());
    }

    #[test]
    fn light_grey_text_on_white_fails() {
        let o = text_contrast(
            &text_screen(image_with_text([255; 3], [0xBB; 3])),
            &android(),
        );
        assert_eq!(o.findings.len(), 1);
        assert!(!o.findings[0].needs_review);
        assert!(o.findings[0].message.contains("#BBBBBB"));
    }

    #[test]
    fn no_screenshot_means_not_applicable() {
        let mut t = node("android.widget.TextView", [100, 100, 700, 200]);
        t.text = Some("Bonjour".into());
        let o = text_contrast(&screen(root(vec![t])), &android());
        assert!(!o.applicable);
    }

    #[test]
    fn downscaled_screenshot_is_mapped() {
        let full = image_with_text([255; 3], [0xBB; 3]);
        let half = image::imageops::resize(&full, 540, 1200, image::imageops::FilterType::Nearest);
        let o = text_contrast(&text_screen(half), &android());
        assert_eq!(o.findings.len(), 1);
    }
}
