// MIME type lookup tables.

pub const MIME_TYPES: &[&str] = &[
    // video
    "video/quicktime",
    "video/mp4",
    "video/x-m4v",
    "video/x-msvideo",
    "video/x-matroska",
    "video/webm",
    "video/3gpp",
    "video/3gpp2",
    "video/mpeg",
    "video/x-ms-wmv",
    "video/x-flv",
    "video/ogg",
    // image
    "image/dng",
    "image/x-adobe-dng",
    "image/x-apple-proraw",
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/avci",
    "image/avcs",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/tiff",
    "image/bmp",
    "image/vnd.microsoft.icon",
    "image/avif",
    "image/jxl",
    "image/vnd.adobe.photoshop",
    "image/x-canon-cr2",
    "image/x-canon-cr3",
    "image/x-nikon-nef",
    "image/x-nikon-nrw",
    "image/x-sony-arw",
    "image/x-fuji-raf",
    "image/x-olympus-orf",
    "image/x-panasonic-rw2",
    "image/x-pentax-pef",
    // audio
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/wav",
    "audio/flac",
    "audio/ogg",
    "audio/opus",
    "audio/aiff",
    "audio/x-caf",
    "audio/amr",
    "audio/x-ms-wma",
    "audio/midi",
    // text/docs
    "text/html",
    "text/css",
    "text/javascript",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "text/xml",
    "text/csv",
    "application/json",
    "application/yaml",
    "application/toml",
    "application/pdf",
    "image/svg+xml",
    // office / iwork / opendocument
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/rtf",
    "application/vnd.apple.pages",
    "application/vnd.apple.numbers",
    "application/vnd.apple.keynote",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    "application/epub+zip",
    "application/x-mobipocket-ebook",
    "application/vnd.amazon.ebook",
    // archives
    "application/zip",
    "application/gzip",
    "application/x-tar",
    "application/x-7z-compressed",
    "application/vnd.rar",
    "application/x-bzip2",
    "application/x-xz",
    "application/zstd",
    "application/x-iso9660-image",
    "application/vnd.ms-cab-compressed",
    // installers/packages
    "application/x-apple-diskimage",
    "application/vnd.microsoft.portable-executable",
    "application/x-msi",
    "application/vnd.debian.binary-package",
    "application/x-rpm",
    "application/vnd.android.package-archive",
    "application/vnd.apple.installer+xml",
    "application/x-iso9660-appimage",
    "application/vnd.snap",
    "application/vnd.flatpak",
    // other
    "application/octet-stream",
];

/// True if the string is one of the known MIME types.
pub fn is_mime_type(t: Option<&str>) -> bool {
    match t {
        Some(s) => MIME_TYPES.contains(&s),
        None => false,
    }
}

/// Map a path's extension (case-insensitive, query/fragment stripped) to a static MIME, or None.
pub fn get_mime_type_from_extension(path: Option<&str>) -> Option<&'static str> {
    let path = path?;
    let stem = path.split('?').next()?.split('#').next()?;
    let ext = stem.rsplit('.').next()?.to_lowercase();
    Some(match ext.as_str() {
        // video
        "mov" | "qt" => "video/quicktime",
        "mp4" => "video/mp4",
        "m4v" => "video/x-m4v",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "3gp" => "video/3gpp",
        "3g2" => "video/3gpp2",
        "mpeg" | "mpg" => "video/mpeg",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "ogv" => "video/ogg",
        // image
        "dng" => "image/dng",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "heics" => "image/heic-sequence",
        "avci" => "image/avci",
        "avcs" => "image/avcs",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "tiff" | "tif" => "image/tiff",
        "bmp" => "image/bmp",
        "ico" => "image/vnd.microsoft.icon",
        "avif" => "image/avif",
        "jxl" => "image/jxl",
        "psd" => "image/vnd.adobe.photoshop",
        "cr2" => "image/x-canon-cr2",
        "cr3" => "image/x-canon-cr3",
        "nef" => "image/x-nikon-nef",
        "nrw" => "image/x-nikon-nrw",
        "arw" => "image/x-sony-arw",
        "raf" => "image/x-fuji-raf",
        "orf" => "image/x-olympus-orf",
        "rw2" => "image/x-panasonic-rw2",
        "pef" => "image/x-pentax-pef",
        // audio
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "aiff" | "aif" => "audio/aiff",
        "caf" => "audio/x-caf",
        "amr" => "audio/amr",
        "wma" => "audio/x-ms-wma",
        "mid" | "midi" => "audio/midi",
        // text/docs
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" => "text/javascript",
        "txt" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "toml" => "application/toml",
        "pdf" => "application/pdf",
        "xml" => "text/xml",
        "csv" => "text/csv",
        "svg" => "image/svg+xml",
        // office / iwork / opendocument
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "rtf" => "application/rtf",
        "pages" => "application/vnd.apple.pages",
        "numbers" => "application/vnd.apple.numbers",
        "key" => "application/vnd.apple.keynote",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "odp" => "application/vnd.oasis.opendocument.presentation",
        "epub" => "application/epub+zip",
        "mobi" => "application/x-mobipocket-ebook",
        "azw3" => "application/vnd.amazon.ebook",
        // archives
        "zip" => "application/zip",
        "gz" | "tgz" => "application/gzip",
        "tar" => "application/x-tar",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/vnd.rar",
        "bz2" | "tbz" | "tbz2" => "application/x-bzip2",
        "xz" => "application/x-xz",
        "zst" => "application/zstd",
        "iso" => "application/x-iso9660-image",
        "cab" => "application/vnd.ms-cab-compressed",
        // installers/packages
        "dmg" => "application/x-apple-diskimage",
        "exe" => "application/vnd.microsoft.portable-executable",
        "msi" => "application/x-msi",
        "deb" => "application/vnd.debian.binary-package",
        "rpm" => "application/x-rpm",
        "apk" => "application/vnd.android.package-archive",
        "pkg" => "application/vnd.apple.installer+xml",
        "appimage" => "application/x-iso9660-appimage",
        "snap" => "application/vnd.snap",
        "flatpak" => "application/vnd.flatpak",
        // source code → text/plain
        "ts" | "tsx" | "jsx" | "py" | "rb" | "go" | "rs" | "java" | "kt" | "swift" | "c" | "h"
        | "cpp" | "hpp" | "cs" | "php" | "lua" | "sh" | "bash" | "zsh" | "sql" | "r" | "scala"
        | "dart" | "vue" | "svelte" => "text/plain",
        // config → text/plain
        "ini" | "cfg" | "conf" | "env" | "log" => "text/plain",
        _ => return None,
    })
}

/// Canonical extension (with dot) for a MIME, or ".bin" when unknown/None.
pub fn ext_from_mime(mime: Option<&str>) -> &'static str {
    let mime = match mime {
        Some(m) => m,
        None => return ".bin",
    };
    match mime {
        // video
        "video/quicktime" => ".mov",
        "video/mp4" => ".mp4",
        "video/x-m4v" => ".m4v",
        "video/x-msvideo" | "video/avi" => ".avi",
        "video/x-matroska" => ".mkv",
        "video/webm" => ".webm",
        "video/3gpp" => ".3gp",
        "video/3gpp2" => ".3g2",
        "video/mpeg" => ".mpeg",
        "video/x-ms-wmv" => ".wmv",
        "video/x-flv" => ".flv",
        "video/ogg" => ".ogv",
        // image
        "image/dng" | "image/x-adobe-dng" | "image/x-apple-proraw" => ".dng",
        "image/heic" => ".heic",
        "image/heif" => ".heif",
        "image/heic-sequence" | "image/heif-sequence" => ".heics",
        "image/avci" => ".avci",
        "image/avcs" => ".avcs",
        "image/jpeg" => ".jpg",
        "image/png" => ".png",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        "image/tiff" => ".tiff",
        "image/bmp" => ".bmp",
        "image/vnd.microsoft.icon" | "image/x-icon" => ".ico",
        "image/avif" => ".avif",
        "image/jxl" => ".jxl",
        "image/vnd.adobe.photoshop" => ".psd",
        "image/x-canon-cr2" => ".cr2",
        "image/x-canon-cr3" => ".cr3",
        "image/x-nikon-nef" => ".nef",
        "image/x-nikon-nrw" => ".nrw",
        "image/x-sony-arw" => ".arw",
        "image/x-fuji-raf" => ".raf",
        "image/x-olympus-orf" => ".orf",
        "image/x-panasonic-rw2" => ".rw2",
        "image/x-pentax-pef" => ".pef",
        // audio
        "audio/mpeg" => ".mp3",
        "audio/mp4" | "audio/x-m4a" => ".m4a",
        "audio/aac" => ".aac",
        "audio/wav" => ".wav",
        "audio/flac" => ".flac",
        "audio/ogg" => ".ogg",
        "audio/opus" => ".opus",
        "audio/aiff" => ".aiff",
        "audio/x-caf" => ".caf",
        "audio/amr" => ".amr",
        "audio/x-ms-wma" => ".wma",
        "audio/midi" => ".midi",
        // text/docs
        "text/html" => ".html",
        "text/css" => ".css",
        "text/javascript" => ".js",
        "text/plain" => ".txt",
        "text/markdown" | "text/x-markdown" => ".md",
        "application/json" => ".json",
        "application/yaml" => ".yaml",
        "application/toml" => ".toml",
        "application/pdf" => ".pdf",
        "text/xml" => ".xml",
        "text/csv" => ".csv",
        "image/svg+xml" => ".svg",
        // office / iwork / opendocument
        "application/msword" => ".doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => ".docx",
        "application/vnd.ms-excel" => ".xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => ".xlsx",
        "application/vnd.ms-powerpoint" => ".ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => ".pptx",
        "application/rtf" => ".rtf",
        "application/vnd.apple.pages" => ".pages",
        "application/vnd.apple.numbers" => ".numbers",
        "application/vnd.apple.keynote" => ".key",
        "application/vnd.oasis.opendocument.text" => ".odt",
        "application/vnd.oasis.opendocument.spreadsheet" => ".ods",
        "application/vnd.oasis.opendocument.presentation" => ".odp",
        "application/epub+zip" => ".epub",
        "application/x-mobipocket-ebook" => ".mobi",
        "application/vnd.amazon.ebook" => ".azw3",
        // archives
        "application/zip" => ".zip",
        "application/gzip" => ".gz",
        "application/x-tar" => ".tar",
        "application/x-7z-compressed" => ".7z",
        "application/vnd.rar" => ".rar",
        "application/x-bzip2" => ".bz2",
        "application/x-xz" => ".xz",
        "application/zstd" => ".zst",
        "application/x-iso9660-image" => ".iso",
        "application/vnd.ms-cab-compressed" => ".cab",
        // installers
        "application/x-apple-diskimage" => ".dmg",
        "application/vnd.microsoft.portable-executable" => ".exe",
        "application/x-msi" => ".msi",
        "application/vnd.debian.binary-package" => ".deb",
        "application/x-rpm" => ".rpm",
        "application/vnd.android.package-archive" => ".apk",
        "application/vnd.apple.installer+xml" => ".pkg",
        "application/x-iso9660-appimage" => ".appimage",
        "application/vnd.snap" => ".snap",
        "application/vnd.flatpak" => ".flatpak",
        _ => ".bin",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_extensions_return_correct_mime() {
        assert_eq!(
            get_mime_type_from_extension(Some("photo.jpg")),
            Some("image/jpeg")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("photo.jpeg")),
            Some("image/jpeg")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("image.png")),
            Some("image/png")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("video.mp4")),
            Some("video/mp4")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("video.mov")),
            Some("video/quicktime")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("song.mp3")),
            Some("audio/mpeg")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("doc.pdf")),
            Some("application/pdf")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("data.json")),
            Some("application/json")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("notes.md")),
            Some("text/markdown")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("notes.txt")),
            Some("text/plain")
        );
    }

    #[test]
    fn extension_lookup_is_case_insensitive() {
        assert_eq!(
            get_mime_type_from_extension(Some("photo.JPG")),
            Some("image/jpeg")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("photo.Png")),
            Some("image/png")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("video.MP4")),
            Some("video/mp4")
        );
    }

    #[test]
    fn unknown_extensions_return_none() {
        assert_eq!(get_mime_type_from_extension(Some("file.xyz")), None);
        assert_eq!(get_mime_type_from_extension(Some("file.foo")), None);
    }

    #[test]
    fn empty_or_missing_input_returns_none() {
        assert_eq!(get_mime_type_from_extension(None), None);
        assert_eq!(get_mime_type_from_extension(Some("")), None);
    }

    #[test]
    fn handles_paths_with_query_strings_and_fragments() {
        assert_eq!(
            get_mime_type_from_extension(Some("photo.jpg?v=1")),
            Some("image/jpeg")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("photo.png#section")),
            Some("image/png")
        );
    }

    #[test]
    fn handles_full_paths() {
        assert_eq!(
            get_mime_type_from_extension(Some("/path/to/photo.jpg")),
            Some("image/jpeg")
        );
        assert_eq!(
            get_mime_type_from_extension(Some("file:///tmp/video.mp4")),
            Some("video/mp4")
        );
    }

    #[test]
    fn video_extensions() {
        let cases: &[(&str, &str)] = &[
            ("movie.avi", "video/x-msvideo"),
            ("movie.mkv", "video/x-matroska"),
            ("movie.webm", "video/webm"),
            ("clip.3gp", "video/3gpp"),
            ("clip.3g2", "video/3gpp2"),
            ("movie.mpeg", "video/mpeg"),
            ("movie.mpg", "video/mpeg"),
            ("movie.wmv", "video/x-ms-wmv"),
            ("movie.flv", "video/x-flv"),
            ("movie.ogv", "video/ogg"),
            ("movie.m4v", "video/x-m4v"),
        ];
        for (path, mime) in cases {
            assert_eq!(
                get_mime_type_from_extension(Some(path)),
                Some(*mime),
                "{}",
                path
            );
        }
    }

    #[test]
    fn image_extensions() {
        let cases: &[(&str, &str)] = &[
            ("icon.bmp", "image/bmp"),
            ("favicon.ico", "image/vnd.microsoft.icon"),
            ("photo.avif", "image/avif"),
            ("photo.jxl", "image/jxl"),
            ("live.heics", "image/heic-sequence"),
            ("design.psd", "image/vnd.adobe.photoshop"),
            ("raw.cr2", "image/x-canon-cr2"),
            ("raw.cr3", "image/x-canon-cr3"),
            ("raw.nef", "image/x-nikon-nef"),
            ("raw.arw", "image/x-sony-arw"),
        ];
        for (path, mime) in cases {
            assert_eq!(
                get_mime_type_from_extension(Some(path)),
                Some(*mime),
                "{}",
                path
            );
        }
    }

    #[test]
    fn audio_extensions() {
        let cases: &[(&str, &str)] = &[
            ("song.flac", "audio/flac"),
            ("song.ogg", "audio/ogg"),
            ("song.oga", "audio/ogg"),
            ("song.opus", "audio/opus"),
            ("song.aiff", "audio/aiff"),
            ("song.aif", "audio/aiff"),
            ("memo.caf", "audio/x-caf"),
            ("call.amr", "audio/amr"),
            ("song.wma", "audio/x-ms-wma"),
            ("tune.mid", "audio/midi"),
            ("tune.midi", "audio/midi"),
        ];
        for (path, mime) in cases {
            assert_eq!(
                get_mime_type_from_extension(Some(path)),
                Some(*mime),
                "{}",
                path
            );
        }
    }

    #[test]
    fn ext_from_mime_round_trip() {
        assert_eq!(ext_from_mime(Some("image/jpeg")), ".jpg");
        assert_eq!(ext_from_mime(Some("video/mp4")), ".mp4");
        assert_eq!(ext_from_mime(Some("audio/mpeg")), ".mp3");
        assert_eq!(ext_from_mime(Some("application/pdf")), ".pdf");
        assert_eq!(ext_from_mime(None), ".bin");
        assert_eq!(ext_from_mime(Some("not/a-mime")), ".bin");
    }

    #[test]
    fn is_mime_type_known() {
        assert!(is_mime_type(Some("image/jpeg")));
        assert!(is_mime_type(Some("video/mp4")));
        assert!(is_mime_type(Some("application/octet-stream")));
    }

    #[test]
    fn is_mime_type_unknown() {
        assert!(!is_mime_type(Some("not/a-mime")));
        assert!(!is_mime_type(None));
    }
}
