use crate::lib_utils::file_types::get_mime_type_from_extension;

const FTYP_BRANDS_HEIC: &[&[u8; 4]] = &[b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis"];
const FTYP_BRANDS_VIDEO: &[&[u8; 4]] = &[
    b"isom", b"iso2", b"mp41", b"mp42", b"M4V ", b"3gp4", b"3gp5", b"3gp6", b"3g2a", b"3g2b",
    b"3g2c",
];
const FTYP_BRANDS_AUDIO: &[&[u8; 4]] = &[b"M4A ", b"M4B "];

pub const MAGIC_BYTES_LENGTH: usize = 32;

/// Detect MIME type from file magic bytes.
pub fn detect_mime_type_from_bytes(bytes: &[u8]) -> Option<&'static str> {
    if bytes.is_empty() {
        return None;
    }
    let len = bytes.len();
    if len >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return Some("image/jpeg");
    }
    if len >= 8 && bytes[..8] == [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] {
        return Some("image/png");
    }
    if len >= 4 && bytes[..4] == [0x47, 0x49, 0x46, 0x38] {
        return Some("image/gif");
    }
    if len >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if len >= 2 && bytes[0] == 0x42 && bytes[1] == 0x4d {
        return Some("image/bmp");
    }
    // TIFF, little-endian then big-endian byte order.
    if len >= 4 && bytes[..4] == [0x49, 0x49, 0x2a, 0x00] {
        return Some("image/tiff");
    }
    if len >= 4 && bytes[..4] == [0x4d, 0x4d, 0x00, 0x2a] {
        return Some("image/tiff");
    }
    // ftyp box: brand at offset 8 selects HEIC/HEIF/AVIF/MP4/MOV/M4A.
    if len >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = &bytes[8..12];
        if FTYP_BRANDS_HEIC.iter().any(|b| *b == brand) {
            return Some("image/heic");
        }
        if brand == b"mif1" {
            return Some("image/heif");
        }
        if brand == b"avif" {
            return Some("image/avif");
        }
        if FTYP_BRANDS_VIDEO.iter().any(|b| *b == brand) {
            return Some("video/mp4");
        }
        if brand == b"qt  " || brand == b"mov " {
            return Some("video/quicktime");
        }
        if FTYP_BRANDS_AUDIO.iter().any(|b| *b == brand) {
            return Some("audio/mp4");
        }
    }
    // RIFF container disambiguated by the chunk-type field at offset 8.
    if len >= 12 && &bytes[..4] == b"RIFF" {
        if &bytes[8..12] == b"WAVE" {
            return Some("audio/wav");
        }
        if &bytes[8..12] == b"AVI " {
            return Some("video/x-msvideo");
        }
    }
    // AIFF or its compressed AIFC variant.
    if len >= 12
        && &bytes[..4] == b"FORM"
        && &bytes[8..11] == b"AIF"
        && (bytes[11] == b'F' || bytes[11] == b'C')
    {
        return Some("audio/aiff");
    }
    if len >= 4 && &bytes[..4] == b"fLaC" {
        return Some("audio/flac");
    }
    if len >= 4 && &bytes[..4] == b"OggS" {
        return Some("audio/ogg");
    }
    // EBML header is shared by MKV and WebM; defaults to MKV. The extension
    // lookup runs first and resolves WebM via the .webm extension.
    if len >= 4 && bytes[..4] == [0x1a, 0x45, 0xdf, 0xa3] {
        return Some("video/x-matroska");
    }
    if len >= 6 && bytes[..6] == [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] {
        return Some("application/x-7z-compressed");
    }
    if len >= 3 && bytes[..3] == [0x42, 0x5a, 0x68] {
        return Some("application/x-bzip2");
    }
    if len >= 6 && bytes[..6] == [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] {
        return Some("application/x-xz");
    }
    // RAR v1.5+ (trailing 0x00) and v5 (trailing 0x01).
    if len >= 7
        && bytes[..6] == [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]
        && (bytes[6] == 0x00 || bytes[6] == 0x01)
    {
        return Some("application/vnd.rar");
    }
    // ZIP and ZIP-based formats (docx/xlsx/pptx/epub/apk). The three valid
    // third/fourth bytes are local-file-header, end-of-central-directory, and
    // data-descriptor markers.
    if len >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4b {
        let b2 = bytes[2];
        let b3 = bytes[3];
        if (b2 == 0x03 && b3 == 0x04) || (b2 == 0x05 && b3 == 0x06) || (b2 == 0x07 && b3 == 0x08) {
            return Some("application/zip");
        }
    }
    if len >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        return Some("application/gzip");
    }
    // ID3 tag or a raw MPEG audio frame sync. The reserved-layer check rules out
    // AAC ADTS, which shares the 11-bit sync prefix but always carries layer=00.
    if len >= 3 {
        if &bytes[..3] == b"ID3" {
            return Some("audio/mpeg");
        }
        if bytes[0] == 0xff
            && (bytes[1] & 0xe0) == 0xe0 // 11-bit sync
            && (bytes[1] & 0x18) != 0x08 // version not reserved
            && (bytes[1] & 0x06) != 0x00
        // layer not reserved
        {
            return Some("audio/mpeg");
        }
    }
    if len >= 4 && &bytes[..4] == b"%PDF" {
        return Some("application/pdf");
    }
    None
}

pub struct DetectMimeTypeOpts<'a> {
    pub provided_type: Option<&'a str>,
    pub file_name: Option<&'a str>,
    pub bytes: Option<&'a [u8]>,
}

/// Priority chain: magic bytes, then extension, then a recognized provided type,
/// then octet-stream.
pub fn detect_mime_type(opts: DetectMimeTypeOpts<'_>) -> &'static str {
    opts.bytes
        .and_then(detect_mime_type_from_bytes)
        .or_else(|| get_mime_type_from_extension(opts.file_name))
        .or_else(|| opts.provided_type.and_then(provided_type_as_static))
        .unwrap_or("application/octet-stream")
}

/// Match a caller-supplied MIME type against the static list, returning the
/// `&'static str` entry (the borrowed input cannot be returned).
fn provided_type_as_static(t: &str) -> Option<&'static str> {
    crate::lib_utils::file_types::MIME_TYPES
        .iter()
        .copied()
        .find(|&k| k == t)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts<'a>(
        provided: Option<&'a str>,
        name: Option<&'a str>,
        bytes: Option<&'a [u8]>,
    ) -> DetectMimeTypeOpts<'a> {
        DetectMimeTypeOpts {
            provided_type: provided,
            file_name: name,
            bytes,
        }
    }

    #[test]
    fn returns_provided_type_when_recognized() {
        assert_eq!(
            detect_mime_type(opts(Some("image/jpeg"), None, None)),
            "image/jpeg"
        );
        assert_eq!(
            detect_mime_type(opts(Some("video/mp4"), None, None)),
            "video/mp4"
        );
        assert_eq!(
            detect_mime_type(opts(Some("application/pdf"), None, None)),
            "application/pdf"
        );
    }

    #[test]
    fn ignores_unrecognized_provided_type_and_falls_through_to_extension() {
        assert_eq!(
            detect_mime_type(opts(Some("foo/bar"), Some("photo.jpg"), None)),
            "image/jpeg"
        );
    }

    #[test]
    fn falls_through_to_extension_when_provided_type_is_none() {
        assert_eq!(
            detect_mime_type(opts(None, Some("photo.png"), None)),
            "image/png"
        );
    }

    #[test]
    fn detects_type_from_filename_extension() {
        assert_eq!(
            detect_mime_type(opts(None, Some("video.mp4"), None)),
            "video/mp4"
        );
        assert_eq!(
            detect_mime_type(opts(None, Some("song.mp3"), None)),
            "audio/mpeg"
        );
        assert_eq!(
            detect_mime_type(opts(None, Some("doc.pdf"), None)),
            "application/pdf"
        );
    }

    #[test]
    fn detects_jpeg_from_magic_bytes() {
        let b = [0xff, 0xd8, 0xff, 0xe0];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "image/jpeg");
    }

    #[test]
    fn detects_png_from_magic_bytes() {
        let b = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "image/png");
    }

    #[test]
    fn detects_gif_from_magic_bytes() {
        let b = [0x47, 0x49, 0x46, 0x38];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "image/gif");
    }

    #[test]
    fn detects_pdf_from_magic_bytes() {
        let b = [0x25, 0x50, 0x44, 0x46];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b))),
            "application/pdf"
        );
    }

    #[test]
    fn prioritizes_bytes_over_misleading_extension() {
        let b = [0xff, 0xd8, 0xff, 0xe0];
        assert_eq!(
            detect_mime_type(opts(None, Some("photo.heic"), Some(&b))),
            "image/jpeg"
        );
    }

    #[test]
    fn prioritizes_bytes_over_misleading_provided_type() {
        let b = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        assert_eq!(
            detect_mime_type(opts(Some("image/jpeg"), None, Some(&b))),
            "image/png"
        );
    }

    #[test]
    fn prioritizes_bytes_over_extension_over_provided_type() {
        let b = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        assert_eq!(
            detect_mime_type(opts(Some("video/mp4"), Some("photo.jpg"), Some(&b))),
            "image/png"
        );
    }

    #[test]
    fn falls_back_to_extension_when_bytes_unrecognized() {
        let garbage = [0x00, 0x01, 0x02, 0x03];
        assert_eq!(
            detect_mime_type(opts(None, Some("doc.pdf"), Some(&garbage))),
            "application/pdf"
        );
    }

    #[test]
    fn falls_back_to_provided_type_when_bytes_and_extension_fail() {
        assert_eq!(
            detect_mime_type(opts(Some("image/jpeg"), Some("no-extension"), None)),
            "image/jpeg"
        );
    }

    #[test]
    fn returns_octet_stream_when_no_signals() {
        assert_eq!(
            detect_mime_type(opts(None, None, None)),
            "application/octet-stream"
        );
    }

    #[test]
    fn returns_octet_stream_for_unknown_extension_and_no_bytes() {
        assert_eq!(
            detect_mime_type(opts(None, Some("file.xyz"), None)),
            "application/octet-stream"
        );
    }

    #[test]
    fn returns_octet_stream_when_all_signals_are_null() {
        assert_eq!(
            detect_mime_type(opts(None, None, None)),
            "application/octet-stream"
        );
    }

    #[test]
    fn falls_through_unrecognized_bytes_to_octet_stream() {
        let random_bytes = [0x00, 0x01, 0x02, 0x03];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&random_bytes))),
            "application/octet-stream"
        );
    }

    #[test]
    fn detects_avi_from_riff_avi() {
        let b = [
            0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20,
        ];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b))),
            "video/x-msvideo"
        );
    }

    #[test]
    fn detects_wav_from_riff_wave() {
        let b = [
            0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
        ];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "audio/wav");
    }

    #[test]
    fn detects_aiff_from_form_aiff() {
        let b = [
            0x46, 0x4f, 0x52, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x41, 0x49, 0x46, 0x46,
        ];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "audio/aiff");
    }

    #[test]
    fn detects_aifc_from_form_aifc() {
        let b = [
            0x46, 0x4f, 0x52, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x41, 0x49, 0x46, 0x43,
        ];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "audio/aiff");
    }

    #[test]
    fn detects_flac_from_magic_bytes() {
        let b = [0x66, 0x4c, 0x61, 0x43];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "audio/flac");
    }

    #[test]
    fn detects_ogg_from_magic_bytes() {
        let b = [0x4f, 0x67, 0x67, 0x53];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "audio/ogg");
    }

    #[test]
    fn detects_mkv_from_ebml_magic_bytes() {
        let b = [0x1a, 0x45, 0xdf, 0xa3];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b))),
            "video/x-matroska"
        );
    }

    #[test]
    fn detects_7z_from_magic_bytes() {
        let b = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b))),
            "application/x-7z-compressed"
        );
    }

    #[test]
    fn detects_bzip2_from_magic_bytes() {
        let b = [0x42, 0x5a, 0x68, 0x39];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b))),
            "application/x-bzip2"
        );
    }

    #[test]
    fn detects_xz_from_magic_bytes() {
        let b = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b))),
            "application/x-xz"
        );
    }

    #[test]
    fn detects_rar_v1_5_from_magic_bytes() {
        let b = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b))),
            "application/vnd.rar"
        );
    }

    #[test]
    fn detects_rar_v5_from_magic_bytes() {
        let b = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b))),
            "application/vnd.rar"
        );
    }

    #[test]
    fn detects_zip_from_magic_bytes() {
        let b = [0x50, 0x4b, 0x03, 0x04];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b))),
            "application/zip"
        );
    }

    #[test]
    fn detects_gzip_from_magic_bytes() {
        let b = [0x1f, 0x8b, 0x08, 0x00];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b))),
            "application/gzip"
        );
    }

    #[test]
    fn detects_mp3_mpeg1_layer3() {
        let b = [0xff, 0xfb, 0x00, 0x00];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "audio/mpeg");
    }

    #[test]
    fn detects_mp3_mpeg2_layer3() {
        let b = [0xff, 0xf3, 0x00, 0x00];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "audio/mpeg");
    }

    #[test]
    fn detects_mp3_mpeg2_5_layer3() {
        let b = [0xff, 0xe3, 0x00, 0x00];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "audio/mpeg");
    }

    #[test]
    fn does_not_misidentify_aac_adts_as_mp3() {
        let b1 = [0xff, 0xf1, 0x50, 0x40];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b1))),
            "application/octet-stream"
        );
        let b2 = [0xff, 0xf9, 0x50, 0x40];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b2))),
            "application/octet-stream"
        );
    }

    #[test]
    fn detects_zip_empty_archive_marker() {
        let b = [0x50, 0x4b, 0x05, 0x06];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b))),
            "application/zip"
        );
    }

    #[test]
    fn detects_zip_spanned_archive_descriptor() {
        let b = [0x50, 0x4b, 0x07, 0x08];
        assert_eq!(
            detect_mime_type(opts(None, None, Some(&b))),
            "application/zip"
        );
    }

    #[test]
    fn rejects_invalid_pk_prefixes() {
        let invalid_combos = [
            [0x50, 0x4b, 0x03, 0x06],
            [0x50, 0x4b, 0x03, 0x08],
            [0x50, 0x4b, 0x05, 0x04],
            [0x50, 0x4b, 0x05, 0x08],
            [0x50, 0x4b, 0x07, 0x04],
            [0x50, 0x4b, 0x07, 0x06],
        ];
        for b in &invalid_combos {
            assert_eq!(
                detect_mime_type(opts(None, None, Some(b))),
                "application/octet-stream"
            );
        }
    }

    #[test]
    fn detects_3gp4_as_video_mp4() {
        let b = [
            0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x33, 0x67, 0x70, 0x34,
        ];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "video/mp4");
    }

    #[test]
    fn detects_3g2a_as_video_mp4() {
        let b = [
            0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x33, 0x67, 0x32, 0x61,
        ];
        assert_eq!(detect_mime_type(opts(None, None, Some(&b))), "video/mp4");
    }

    #[test]
    fn honors_provided_type_video_x_msvideo() {
        assert_eq!(
            detect_mime_type(opts(Some("video/x-msvideo"), None, None)),
            "video/x-msvideo"
        );
    }

    #[test]
    fn falls_back_to_magic_bytes_when_provided_type_unknown() {
        let b = [
            0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20,
        ];
        assert_eq!(
            detect_mime_type(opts(Some("foo/bar"), None, Some(&b))),
            "video/x-msvideo"
        );
    }
}
