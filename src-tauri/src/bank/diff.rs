// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

use image::ImageEncoder;

pub struct DiffOutcome {
    pub changed_ratio: f32,
    pub bbox: Option<[u32; 4]>,
    pub diff_png: Vec<u8>,
}

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
