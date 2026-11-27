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
    /// Height in image pixels of the text pixels' bounding box, when they
    /// could be located (glyph height, a better font-size proxy than the
    /// element's bounds, which include padding and margins).
    pub text_height: Option<u32>,
}

/// Minimum share of the box a colour must cover to count as the text colour.
const MIN_FG_SHARE: f64 = 0.02;
/// Below this background share the background isn't uniform enough to trust.
const UNIFORM_BG_SHARE: f64 = 0.5;

type Key = (u8, u8, u8);

/// 5 bits per channel: close colours (anti-aliasing, JPEG noise) share a key.
fn key(p: [u8; 4]) -> Key {
    (p[0] >> 3, p[1] >> 3, p[2] >> 3)
}

/// One clustering pass over a rectangle: the most frequent colour is the
/// background, the colour with the highest contrast against it (among those
/// covering a meaningful share) is the text. Returns the text colour's key
/// too, so the caller can locate the text pixels.
fn estimate_rect(img: &RgbaImage, x0: u32, y0: u32, x1: u32, y1: u32) -> Option<(Estimate, Key)> {
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    // Sample at most ~40k pixels.
    let area = ((x1 - x0) * (y1 - y0)) as f64;
    let step = ((area / 40_000.0).sqrt().ceil() as u32).max(1);

    // Bucket by key, keep the true average per bucket.
    let mut buckets: HashMap<Key, (u64, [u64; 3])> = HashMap::new();
    let mut total = 0u64;
    let mut y = y0;
    while y < y1 {
        let mut x = x0;
        while x < x1 {
            let p = img.get_pixel(x, y).0;
            let e = buckets.entry(key(p)).or_insert((0, [0; 3]));
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

    let (_, bg) = buckets.iter().max_by_key(|(_, (n, _))| *n)?;
    let background = avg(bg);
    let (fg_key, fg) = buckets
        .iter()
        .filter(|(_, (n, _))| *n as f64 / total as f64 >= MIN_FG_SHARE)
        .map(|(k, b)| (*k, avg(b)))
        .max_by(|(_, a), (_, b)| {
            contrast_ratio(*a, background)
                .partial_cmp(&contrast_ratio(*b, background))
                .unwrap_or(std::cmp::Ordering::Equal)
        })?;
    if fg == background {
        return None; // no visible text pixels
    }
    Some((
        Estimate {
            background,
            foreground: fg,
            background_share: bg.0 as f64 / total as f64,
            text_height: None,
        },
        fg_key,
    ))
}

/// Pixels around the text that still count as its background.
const TEXT_PAD: u32 = 3;

/// Estimates the text and background colours inside an element's bounds.
///
/// An element's bounds often include more than what's behind the text: the
/// white margin around a Material button (its insets), the screen around a
/// pill. A single pass over the whole box can then take that margin as the
/// background. So a second pass is made on the tight box around the pixels
/// found in the first pass (the text, or the button fill when the text is
/// lighter than the margin), where the real background dominates.
pub fn estimate(img: &RgbaImage, b: &Bounds) -> Option<Estimate> {
    let (w, h) = img.dimensions();
    let x0 = b.left.max(0) as u32;
    let y0 = b.top.max(0) as u32;
    let x1 = (b.right.max(0) as u32).min(w);
    let y1 = (b.bottom.max(0) as u32).min(h);
    let (first, fg_key) = estimate_rect(img, x0, y0, x1, y1)?;

    // Tight box around the pixels of the first pass's text colour.
    let (mut tx0, mut ty0, mut tx1, mut ty1) = (u32::MAX, u32::MAX, 0u32, 0u32);
    for y in y0..y1 {
        for x in x0..x1 {
            if key(img.get_pixel(x, y).0) == fg_key {
                tx0 = tx0.min(x);
                ty0 = ty0.min(y);
                tx1 = tx1.max(x + 1);
                ty1 = ty1.max(y + 1);
            }
        }
    }
    if tx1 <= tx0 || ty1 <= ty0 {
        return Some(first);
    }
    // Second pass: the background is the most frequent colour right around
    // the text, the text colour itself excluded (dense text can outnumber
    // its background in a tight box).
    let pad = TEXT_PAD.max((ty1 - ty0) * 3 / 10);
    let (bx0, by0) = (
        tx0.saturating_sub(pad).max(x0),
        ty0.saturating_sub(pad).max(y0),
    );
    let (bx1, by1) = ((tx1 + pad).min(x1), (ty1 + pad).min(y1));
    let mut around: HashMap<Key, (u64, [u64; 3])> = HashMap::new();
    let mut total = 0u64;
    for y in by0..by1 {
        for x in bx0..bx1 {
            let p = img.get_pixel(x, y).0;
            let k = key(p);
            if k == fg_key {
                continue;
            }
            let e = around.entry(k).or_insert((0, [0; 3]));
            e.0 += 1;
            for (sum, c) in e.1.iter_mut().zip(p) {
                *sum += c as u64;
            }
            total += 1;
        }
    }
    let Some((n, sums)) = around.values().max_by_key(|(n, _)| *n) else {
        return Some(first);
    };
    let background = [
        (sums[0] / n) as u8,
        (sums[1] / n) as u8,
        (sums[2] / n) as u8,
    ];
    Some(Estimate {
        background,
        foreground: first.foreground,
        background_share: *n as f64 / total as f64,
        text_height: Some(ty1 - ty0),
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
        // WCAG "large text" is 18 pt (≈ 24 dp/pt). Measured on the glyphs:
        // a 24 dp font gives a text box of ≈ 17 dp or more. Without glyphs,
        // fall back on the element's height (≥ 32 dp ≈ 24 dp + padding).
        let screen_h = (screen_bounds(&screen.root).bottom).max(1) as f32;
        let large = match est.text_height {
            Some(px) => px as f32 * (screen_h / img.height() as f32) / density >= 17.0,
            None => (n.bounds.bottom - n.bounds.top) as f32 / density >= 32.0,
        };
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

    /// A grey Material-like button (fill #E0E0E0) with a white margin around
    /// it inside the element's bounds, and `text` drawn on the fill.
    fn grey_button(text: [u8; 3]) -> RgbaImage {
        let mut img = RgbaImage::from_pixel(1080, 2400, Rgba([255, 255, 255, 255]));
        // element bounds: [100,100,700,300]; fill only [130,140,670,260]
        for y in 140..260 {
            for x in 130..670 {
                img.put_pixel(x, y, Rgba([0xE0, 0xE0, 0xE0, 255]));
            }
        }
        for y in 190..210 {
            for x in 250..550 {
                img.put_pixel(x, y, Rgba([text[0], text[1], text[2], 255]));
            }
        }
        img
    }

    fn button_screen(img: RgbaImage) -> Screen {
        let mut b = node("android.widget.Button", [100, 100, 700, 300]);
        b.text = Some("Valider".into());
        let mut s = screen(root(vec![b]));
        s.screenshot = Some(img);
        s
    }

    #[test]
    fn background_is_the_button_fill_not_its_white_margin() {
        // White margin covers ~46% of the box, the grey fill the rest.
        let est = estimate(
            &grey_button([0x75, 0x75, 0x75]),
            &Bounds {
                left: 100,
                top: 100,
                right: 700,
                bottom: 300,
            },
        )
        .unwrap();
        assert_eq!(est.background, [0xE0, 0xE0, 0xE0]);
        assert_eq!(est.foreground, [0x75, 0x75, 0x75]);
    }

    #[test]
    fn grey_text_on_grey_button_fails_even_with_white_margin() {
        // #757575 on white is 4.6:1 (pass) but on #E0E0E0 only ≈ 3.5:1.
        let o = text_contrast(&button_screen(grey_button([0x75, 0x75, 0x75])), &android());
        assert_eq!(o.findings.len(), 1, "{:?}", o.findings);
        assert!(
            o.findings[0].message.contains("#E0E0E0"),
            "{}",
            o.findings[0].message
        );
    }

    #[test]
    fn white_text_on_grey_button_is_measured_against_the_fill() {
        // Text lighter than the margin case: white on #E0E0E0 ≈ 1.3:1.
        let o = text_contrast(&button_screen(grey_button([0xFF, 0xFF, 0xFF])), &android());
        // White text on a white margin is invisible in pass 1; the fill is
        // found instead and measured against the margin: still a failure.
        assert_eq!(o.findings.len(), 1, "{:?}", o.findings);
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
