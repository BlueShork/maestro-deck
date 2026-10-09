//! `ui.copyImage`: a plugin hands a base64 PNG, the host puts it on the
//! system clipboard. The sandboxed plugin frame cannot write the clipboard.

use base64::Engine;

/// Base64 characters, matching the TS bridge limit.
pub const MAX_B64: usize = 10 * 1024 * 1024;

pub fn decode_png(b64: &str) -> Result<(usize, usize, Vec<u8>), String> {
    if b64.len() > MAX_B64 {
        return Err("too_large: image is over 10 MB".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("bad_request: invalid base64 ({e})"))?;
    let img = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
        .map_err(|e| format!("bad_request: not a PNG ({e})"))?
        .to_rgba8();
    let (w, h) = img.dimensions();
    Ok((w as usize, h as usize, img.into_raw()))
}

pub fn copy_png(b64: &str) -> Result<(), String> {
    let (width, height, bytes) = decode_png(b64)?;
    let mut cb = arboard::Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
    cb.set_image(arboard::ImageData {
        width,
        height,
        bytes: bytes.into(),
    })
    .map_err(|e| format!("clipboard: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_png_b64() -> String {
        let img = image::RgbaImage::from_pixel(2, 1, image::Rgba([250, 80, 15, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png).unwrap();
        base64::engine::general_purpose::STANDARD.encode(out.into_inner())
    }

    #[test]
    fn decodes_a_png_to_rgba() {
        let (w, h, bytes) = decode_png(&tiny_png_b64()).unwrap();
        assert_eq!((w, h), (2, 1));
        assert_eq!(&bytes[..4], &[250, 80, 15, 255]);
    }

    #[test]
    fn rejects_non_png_and_oversize() {
        assert!(decode_png("aGVsbG8=")
            .unwrap_err()
            .starts_with("bad_request"));
        assert!(decode_png("!!").unwrap_err().starts_with("bad_request"));
        assert!(decode_png(&"A".repeat(MAX_B64 + 1))
            .unwrap_err()
            .starts_with("too_large"));
    }
}
