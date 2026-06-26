//! File metadata for indexer objects, stored as JSON matching the TS client. The
//! shape is a discriminated union on `kind` (file or thumb).
//!
//! Encoding always writes v1. Decoding takes v1 strictly and anything newer
//! leniently (so older clients keep the fields they understand), and returns
//! empty metadata on any failure.

use crate::types::files::{FileKind, FileMetadata};
use serde_json::Value;
use tracing::{error, warn};

pub const MAX_SUPPORTED_VERSION: f64 = 1.0;

/// A field was present but the wrong shape, so the parse failed.
struct SchemaMismatch;

/// Parsed fields before the kind split. `to_file_metadata` branches on `kind`.
#[derive(Default)]
struct DecodedFields {
    id: String,
    name: String,
    type_: String,
    kind: String,
    size: i64,
    hash: String,
    created_at: i64,
    updated_at: i64,
    thumb_for_id: Option<String>,
    thumb_size: Option<i64>,
    tags: Option<Vec<String>>,
    directory: Option<String>,
    trashed_at: Option<i64>,
}

/// Optional string: absent or null -> None; a present non-string fails the parse.
fn optional_string(raw: &Value, key: &str) -> Result<Option<String>, SchemaMismatch> {
    match raw.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(SchemaMismatch),
    }
}

/// Optional integer: absent or null -> None; a present non-number fails the
/// parse. A fractional value truncates toward zero.
fn optional_number(raw: &Value, key: &str) -> Result<Option<i64>, SchemaMismatch> {
    match raw.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => Ok(Some(number_to_i64(n))),
        Some(_) => Err(SchemaMismatch),
    }
}

/// Optional string array: absent or null -> None; a non-array or a non-string
/// element fails the parse.
fn optional_string_array(raw: &Value, key: &str) -> Result<Option<Vec<String>>, SchemaMismatch> {
    match raw.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(items)) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                match item {
                    Value::String(s) => out.push(s.clone()),
                    _ => return Err(SchemaMismatch),
                }
            }
            Ok(Some(out))
        }
        Some(_) => Err(SchemaMismatch),
    }
}

/// Truncate a JSON number to i64, toward zero. A fractional size or timestamp
/// truncates rather than failing the parse.
fn number_to_i64(n: &serde_json::Number) -> i64 {
    if let Some(i) = n.as_i64() {
        i
    } else if let Some(f) = n.as_f64() {
        f as i64
    } else {
        0 // unreachable: a Number is always i64, u64, or f64
    }
}

/// Encode metadata as the v1 indexer object. What must match the TS app is the
/// key names, the per-kind fields, and the omission rules below; key order is not
/// significant (both clients read by name, the blob is encrypted before storage).
pub fn encode_file_metadata(meta: &FileMetadata) -> Vec<u8> {
    let kind = match meta.kind {
        FileKind::File => "file",
        FileKind::Thumb => "thumb",
    };
    let mut obj = serde_json::json!({
        "version": 1,
        "id": meta.id,
        "name": meta.name,
        "type": meta.type_,
        "kind": kind,
        "size": meta.size,
        "hash": meta.hash,
        "createdAt": meta.created_at,
        "updatedAt": meta.updated_at,
    });
    let map = obj.as_object_mut().expect("json! builds an object");
    match meta.kind {
        FileKind::File => {
            // Empty array is kept as tags:[]; only None omits the key.
            if let Some(tags) = &meta.tags {
                map.insert("tags".into(), serde_json::json!(tags));
            }
            // Empty directory is omitted; a present "" would change the decoded
            // value and cause a phantom re-sync.
            if let Some(dir) = &meta.directory {
                if !dir.is_empty() {
                    map.insert("directory".into(), serde_json::json!(dir));
                }
            }
            // Files always carry trashedAt (null when not trashed).
            map.insert("trashedAt".into(), serde_json::json!(meta.trashed_at));
        }
        FileKind::Thumb => {
            if let Some(tid) = &meta.thumb_for_id {
                map.insert("thumbForId".into(), serde_json::json!(tid));
            }
            if let Some(ts) = meta.thumb_size {
                map.insert("thumbSize".into(), serde_json::json!(ts));
            }
        }
    }
    serde_json::to_vec(&obj).unwrap_or_default()
}

/// Strict v1 parse. Every base field is required and exactly typed (version 1,
/// strings, numbers). For thumbs, thumbForId must be a string and thumbSize must
/// be 64 or 512. Any mismatch fails.
fn parse_strict_v1(raw: &Value) -> Result<DecodedFields, SchemaMismatch> {
    if raw.get("version").and_then(Value::as_f64) != Some(1.0) {
        return Err(SchemaMismatch);
    }
    let strict_string = |key: &str| -> Result<String, SchemaMismatch> {
        match raw.get(key) {
            Some(Value::String(s)) => Ok(s.clone()),
            _ => Err(SchemaMismatch),
        }
    };
    let strict_number = |key: &str| -> Result<i64, SchemaMismatch> {
        match raw.get(key) {
            Some(Value::Number(n)) => Ok(number_to_i64(n)),
            _ => Err(SchemaMismatch),
        }
    };
    let id = strict_string("id")?;
    let name = strict_string("name")?;
    let type_ = strict_string("type")?;
    let size = strict_number("size")?;
    let hash = strict_string("hash")?;
    let created_at = strict_number("createdAt")?;
    let updated_at = strict_number("updatedAt")?;
    let kind = match raw.get("kind") {
        Some(Value::String(s)) if s == "file" => "file".to_string(),
        Some(Value::String(s)) if s == "thumb" => "thumb".to_string(),
        _ => return Err(SchemaMismatch),
    };
    let mut fields = DecodedFields {
        id,
        name,
        type_,
        kind: kind.clone(),
        size,
        hash,
        created_at,
        updated_at,
        ..Default::default()
    };
    if kind == "file" {
        fields.tags = optional_string_array(raw, "tags")?;
        fields.directory = optional_string(raw, "directory")?;
        fields.trashed_at = optional_number(raw, "trashedAt")?;
    } else {
        let thumb_for_id = strict_string("thumbForId")?;
        // thumbSize must be exactly 64 or 512. JSON numbers are floats, and Rust
        // forbids float literals in match patterns, so compare the value directly.
        let n = raw.get("thumbSize").and_then(Value::as_f64);
        let thumb_size = if n == Some(64.0) {
            64
        } else if n == Some(512.0) {
            512
        } else {
            return Err(SchemaMismatch);
        };
        fields.thumb_for_id = Some(thumb_for_id);
        fields.thumb_size = Some(thumb_size);
    }
    Ok(fields)
}

/// Lenient parse for newer versions. Each base field falls back to a default on
/// a wrong type (strings -> "", numbers -> 0, kind -> "file"). The optional
/// thumb/file fields have no fallback, so a present wrong-typed one still fails.
fn parse_lenient(raw: &Value) -> Result<DecodedFields, SchemaMismatch> {
    if !raw.get("version").is_some_and(Value::is_number) {
        return Err(SchemaMismatch);
    }
    let catch_string = |key: &str| -> String {
        match raw.get(key) {
            Some(Value::String(s)) => s.clone(),
            _ => String::new(),
        }
    };
    let catch_number = |key: &str| -> i64 {
        match raw.get(key) {
            Some(Value::Number(n)) => number_to_i64(n),
            _ => 0,
        }
    };
    // kind falls back to "file" on any other value.
    let kind = match raw.get("kind") {
        Some(Value::String(s)) if s == "thumb" => "thumb".to_string(),
        _ => "file".to_string(),
    };
    Ok(DecodedFields {
        id: catch_string("id"),
        name: catch_string("name"),
        type_: catch_string("type"),
        kind,
        size: catch_number("size"),
        hash: catch_string("hash"),
        created_at: catch_number("createdAt"),
        updated_at: catch_number("updatedAt"),
        // Optionals have no fallback: a present wrong type fails.
        thumb_for_id: optional_string(raw, "thumbForId")?,
        thumb_size: optional_number(raw, "thumbSize")?,
        tags: optional_string_array(raw, "tags")?,
        directory: optional_string(raw, "directory")?,
        trashed_at: optional_number(raw, "trashedAt")?,
    })
}

/// Apply the kind split: files keep tags/directory/trashedAt, thumbs keep
/// thumbForId/thumbSize, and the other kind's fields stay None.
fn to_file_metadata(data: DecodedFields) -> FileMetadata {
    let kind = match data.kind.as_str() {
        "thumb" => FileKind::Thumb,
        _ => FileKind::File,
    };
    let (thumb_for_id, thumb_size, tags, directory, trashed_at) = match kind {
        FileKind::File => (None, None, data.tags, data.directory, data.trashed_at),
        // thumbSize is not re-validated; an out-of-range value (e.g. 128) is kept
        // so decode is lossless.
        FileKind::Thumb => (data.thumb_for_id, data.thumb_size, None, None, None),
    };
    FileMetadata {
        id: data.id,
        name: data.name,
        type_: data.type_,
        kind,
        size: data.size,
        hash: data.hash,
        thumb_for_id,
        thumb_size,
        tags,
        directory,
        trashed_at,
        created_at: data.created_at,
        updated_at: data.updated_at,
    }
}

/// Decode metadata from a server object's bytes. Returns empty metadata on parse
/// failure so callers always get a safe value.
pub fn decode_file_metadata(buffer: &[u8]) -> FileMetadata {
    let raw: Value = match serde_json::from_slice(buffer) {
        Ok(v) => v,
        Err(e) => {
            error!(target: "fileMetadata", error = %e, "decode_error");
            return FileMetadata::empty();
        }
    };
    // A parseable blob with no numeric `version` (e.g. `{}` or a string version)
    // is not a decode error: it falls through to empty metadata with no log.
    // `as_f64` accepts integers, floats, and negatives alike.
    let version = match raw.get("version").and_then(Value::as_f64) {
        Some(v) => v,
        None => return FileMetadata::empty(),
    };
    // Two stages (strict v1, then lenient) give per-field fallback for a
    // wrong-typed base field plus the forward-compat version handling below.
    if version > MAX_SUPPORTED_VERSION {
        warn!(
            target: "fileMetadata",
            version = version,
            max = MAX_SUPPORTED_VERSION,
            "version_exceeds_max"
        );
        // Future versions decode only via the lenient schema.
        match parse_lenient(&raw) {
            Ok(fields) => to_file_metadata(fields),
            Err(SchemaMismatch) => {
                warn!(target: "fileMetadata", version = version, "future_version_parse_failed");
                FileMetadata::empty()
            }
        }
    } else {
        // version <= MAX: try strict v1 first, then fall back to lenient (e.g.
        // an orphaned thumb missing thumbForId, or a v1 blob with a wrong-typed
        // catchable field).
        if let Ok(fields) = parse_strict_v1(&raw) {
            return to_file_metadata(fields);
        }
        warn!(target: "fileMetadata", "v1_parse_failed");
        match parse_lenient(&raw) {
            Ok(fields) => to_file_metadata(fields),
            Err(SchemaMismatch) => {
                warn!(
                    target: "fileMetadata",
                    raw_kind = ?raw.get("kind"),
                    thumb_for_id = ?raw.get("thumbForId"),
                    "v1_lenient_also_failed"
                );
                FileMetadata::empty()
            }
        }
    }
}

/// All required file fields present and JS-truthy (non-empty strings, non-zero
/// numbers).
pub fn has_complete_file_metadata(m: &FileMetadata) -> bool {
    !m.id.is_empty()
        && !m.hash.is_empty()
        && !m.type_.is_empty()
        && !m.name.is_empty()
        && m.size != 0
        && m.updated_at != 0
        && m.created_at != 0
}

/// Superset of [has_complete_file_metadata] that also requires JS-truthy thumb
/// fields. Callers MUST test this BEFORE the file predicate when classifying (a
/// thumbnail blob satisfies both), or thumbnails mis-route to file rows.
pub fn has_complete_thumbnail_metadata(m: &FileMetadata) -> bool {
    // An empty-string `thumbForId` (`Some("")`) or zero `thumbSize` (`Some(0)`)
    // is JS-falsy and must return false; a bare `.is_some()` would wrongly pass
    // both and mis-gate the sync-down thumbnail branch.
    has_complete_file_metadata(m)
        && m.thumb_for_id.as_deref().is_some_and(|s| !s.is_empty())
        && m.thumb_size.is_some_and(|n| n != 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::files::{FileKind, FileMetadata};

    fn sample_file_metadata() -> FileMetadata {
        FileMetadata {
            id: "file-1".into(),
            name: "photo.jpg".into(),
            type_: "image/jpeg".into(),
            kind: FileKind::File,
            size: 1024,
            hash: "abc123".into(),
            thumb_for_id: None,
            thumb_size: None,
            tags: Some(vec!["vacation".into(), "family".into()]),
            directory: Some("Photos/2024".into()),
            trashed_at: None,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_100_000,
        }
    }

    fn sample_thumb_metadata() -> FileMetadata {
        FileMetadata {
            id: "thumb-1".into(),
            name: "photo-thumb.webp".into(),
            type_: "image/webp".into(),
            kind: FileKind::Thumb,
            size: 200,
            hash: "thumb-hash".into(),
            thumb_for_id: Some("file-1".into()),
            thumb_size: Some(512),
            tags: None,
            directory: None,
            trashed_at: None,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn round_trip_file_metadata() {
        let original = sample_file_metadata();
        let bytes = encode_file_metadata(&original);
        let decoded = decode_file_metadata(&bytes);
        assert_eq!(decoded.id, original.id);
        assert_eq!(decoded.name, original.name);
        assert_eq!(decoded.type_, original.type_);
        assert!(matches!(decoded.kind, FileKind::File));
        assert_eq!(decoded.size, original.size);
        assert_eq!(decoded.hash, original.hash);
        assert_eq!(decoded.tags, original.tags);
        assert_eq!(decoded.directory, original.directory);
        assert_eq!(decoded.trashed_at, original.trashed_at);
        assert_eq!(decoded.created_at, original.created_at);
        assert_eq!(decoded.updated_at, original.updated_at);
    }

    #[test]
    fn round_trip_thumb_metadata() {
        let original = sample_thumb_metadata();
        let bytes = encode_file_metadata(&original);
        let decoded = decode_file_metadata(&bytes);
        assert_eq!(decoded.id, original.id);
        assert!(matches!(decoded.kind, FileKind::Thumb));
        assert_eq!(decoded.thumb_for_id, original.thumb_for_id);
        assert_eq!(decoded.thumb_size, Some(512));
    }

    #[test]
    fn encode_omits_empty_directory_but_keeps_empty_tags() {
        // Empty-string directory is omitted (JS-falsy); empty tags array is
        // emitted as [] (JS-truthy). A stray `directory` key would diverge the
        // wire bytes from a TS client and break cross-device sync.
        let mut meta = sample_file_metadata();
        meta.directory = Some(String::new());
        meta.tags = Some(vec![]);
        let bytes = encode_file_metadata(&meta);
        let payload: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let obj = payload.as_object().unwrap();
        assert!(
            !obj.contains_key("directory"),
            "empty-string directory must be omitted (JS-falsy), got: {payload}"
        );
        assert_eq!(
            obj.get("tags"),
            Some(&serde_json::json!([])),
            "empty tags array must be emitted (JS-truthy)"
        );
    }

    #[test]
    fn decode_empty_buffer_returns_empty_metadata() {
        let decoded = decode_file_metadata(&[]);
        assert!(decoded.id.is_empty());
        assert!(matches!(decoded.kind, FileKind::File));
    }

    #[test]
    fn decode_invalid_json_returns_empty_metadata() {
        let decoded = decode_file_metadata(b"not json");
        assert!(decoded.id.is_empty());
    }

    #[test]
    fn has_complete_file_metadata_requires_all_fields() {
        let mut m = sample_file_metadata();
        assert!(has_complete_file_metadata(&m));
        m.id = String::new();
        assert!(!has_complete_file_metadata(&m));
    }

    #[test]
    fn has_complete_thumbnail_metadata_requires_thumb_fields() {
        let m = sample_thumb_metadata();
        assert!(has_complete_thumbnail_metadata(&m));
        let mut m2 = sample_thumb_metadata();
        m2.thumb_for_id = None;
        assert!(!has_complete_thumbnail_metadata(&m2));
    }

    #[test]
    fn has_complete_thumbnail_metadata_false_for_js_falsy_thumb_fields() {
        // An empty-string thumbForId (`Some("")`) and a zero thumbSize (`Some(0)`)
        // are JS-falsy -> false; a bare `.is_some()` check would wrongly return true.
        let mut empty_id = sample_thumb_metadata();
        empty_id.thumb_for_id = Some(String::new());
        assert!(
            !has_complete_thumbnail_metadata(&empty_id),
            "empty-string thumbForId is JS-falsy → false"
        );

        let mut zero_size = sample_thumb_metadata();
        zero_size.thumb_size = Some(0);
        assert!(
            !has_complete_thumbnail_metadata(&zero_size),
            "zero thumbSize is JS-falsy → false"
        );
    }

    #[test]
    fn has_complete_file_metadata_false_for_zero_size_or_timestamps() {
        // A zero numeric field (size/updatedAt/createdAt) is JS-falsy -> false.
        let mut zero_size = sample_file_metadata();
        zero_size.size = 0;
        assert!(!has_complete_file_metadata(&zero_size));

        let mut zero_updated = sample_file_metadata();
        zero_updated.updated_at = 0;
        assert!(!has_complete_file_metadata(&zero_updated));

        let mut zero_created = sample_file_metadata();
        zero_created.created_at = 0;
        assert!(!has_complete_file_metadata(&zero_created));
    }

    #[test]
    fn future_version_decodes_with_lenient_fallback() {
        // A version above MAX decodes leniently instead of being rejected, and
        // unknown fields are ignored.
        let v2 = serde_json::json!({
            "version": 2,
            "id": "file-future",
            "name": "future.bin",
            "type": "application/octet-stream",
            "kind": "file",
            "size": 100,
            "hash": "future-hash",
            "createdAt": 1_700_000_000_000_i64,
            "updatedAt": 1_700_000_000_000_i64,
            "extraField": "ignored"
        });
        let decoded = decode_file_metadata(&serde_json::to_vec(&v2).unwrap());
        assert_eq!(decoded.id, "file-future");
        assert_eq!(decoded.name, "future.bin");
        assert_eq!(decoded.type_, "application/octet-stream");
        assert_eq!(decoded.size, 100);
    }

    #[test]
    fn max_supported_version_is_one() {
        // Pin the forward-compat boundary so a future edit can't silently retune it.
        assert_eq!(MAX_SUPPORTED_VERSION, 1.0);
    }

    fn encode_json(v: serde_json::Value) -> Vec<u8> {
        serde_json::to_vec(&v).unwrap()
    }

    #[test]
    fn decode_keeps_out_of_range_thumb_size() {
        // thumbSize is not re-validated on decode, so 128 round-trips losslessly.
        let bytes = encode_json(serde_json::json!({
            "version": 1,
            "id": "thumb-oor",
            "name": "t.webp",
            "type": "image/webp",
            "kind": "thumb",
            "size": 100,
            "hash": "h",
            "thumbForId": "file-1",
            "thumbSize": 128,
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert!(matches!(decoded.kind, FileKind::Thumb));
        assert_eq!(decoded.thumb_size, Some(128));
        assert_eq!(decoded.thumb_for_id, Some("file-1".into()));
    }

    #[test]
    fn decode_file_drops_thumb_fields() {
        // Thumb fields are read only when kind == 'thumb', so a file blob that
        // carries thumbForId/thumbSize must not leak them onto the decoded file.
        let bytes = encode_json(serde_json::json!({
            "version": 1,
            "id": "file-leak",
            "name": "f.jpg",
            "type": "image/jpeg",
            "kind": "file",
            "size": 10,
            "hash": "h",
            "thumbForId": "should-be-ignored",
            "thumbSize": 64,
            "tags": ["a"],
            "directory": "Photos",
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert!(matches!(decoded.kind, FileKind::File));
        assert_eq!(decoded.thumb_for_id, None);
        assert_eq!(decoded.thumb_size, None);
        assert_eq!(decoded.tags, Some(vec!["a".to_string()]));
        assert_eq!(decoded.directory, Some("Photos".into()));
    }

    #[test]
    fn decode_thumb_drops_file_fields() {
        // tags/directory/trashedAt are read only for files, so a thumb blob that
        // carries them must not leak them onto the decoded thumb.
        let bytes = encode_json(serde_json::json!({
            "version": 1,
            "id": "thumb-leak",
            "name": "t.webp",
            "type": "image/webp",
            "kind": "thumb",
            "size": 10,
            "hash": "h",
            "thumbForId": "file-1",
            "thumbSize": 512,
            "tags": ["should-be-ignored"],
            "directory": "should-be-ignored",
            "trashedAt": 1234,
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert!(matches!(decoded.kind, FileKind::Thumb));
        assert_eq!(decoded.tags, None);
        assert_eq!(decoded.directory, None);
        assert_eq!(decoded.trashed_at, None);
        assert_eq!(decoded.thumb_for_id, Some("file-1".into()));
        assert_eq!(decoded.thumb_size, Some(512));
    }

    #[test]
    fn decode_missing_version_returns_empty_without_decode_error() {
        // A parseable blob with no numeric version falls through to empty without
        // logging decode_error.
        let bytes = encode_json(serde_json::json!({
            "id": "no-version",
            "name": "x.jpg",
            "kind": "file"
        }));
        let decoded = decode_file_metadata(&bytes);
        assert!(decoded.id.is_empty());
        assert!(decoded.hash.is_empty());
        assert!(matches!(decoded.kind, FileKind::File));
    }

    #[test]
    fn decode_non_numeric_version_returns_empty() {
        let bytes = encode_json(serde_json::json!({
            "version": "1",
            "id": "str-version"
        }));
        let decoded = decode_file_metadata(&bytes);
        assert!(decoded.id.is_empty());
    }

    #[test]
    fn future_version_falls_back_to_defaults_for_missing_fields() {
        // `{ version: 10 }` decodes to all-empty defaults: the lenient path catches
        // every base field to its default.
        let bytes = encode_json(serde_json::json!({ "version": 10 }));
        let decoded = decode_file_metadata(&bytes);
        assert!(decoded.id.is_empty());
        assert!(decoded.name.is_empty());
        assert!(matches!(decoded.kind, FileKind::File));
        assert_eq!(decoded.size, 0);
        assert!(decoded.hash.is_empty());
    }

    #[test]
    fn future_version_thumbnail_keeps_thumb_fields() {
        // A future-version thumbnail decodes leniently and keeps its thumb fields.
        let bytes = encode_json(serde_json::json!({
            "version": 3,
            "id": "ft-1",
            "name": "t.jpg",
            "type": "image/jpeg",
            "kind": "thumb",
            "size": 100,
            "hash": "fth",
            "thumbForId": "fp-1",
            "thumbSize": 512,
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert!(matches!(decoded.kind, FileKind::Thumb));
        assert_eq!(decoded.thumb_for_id, Some("fp-1".into()));
        assert_eq!(decoded.thumb_size, Some(512));
    }

    #[test]
    fn has_complete_file_metadata_false_when_hash_missing() {
        // An empty hash makes the completeness predicate return false.
        let bytes = encode_json(serde_json::json!({
            "version": 1,
            "id": "x",
            "name": "x.jpg",
            "type": "image/jpeg",
            "kind": "file",
            "size": 1,
            "hash": "",
            "createdAt": 1,
            "updatedAt": 1
        }));
        assert!(!has_complete_file_metadata(&decode_file_metadata(&bytes)));
    }

    #[test]
    fn has_complete_thumbnail_metadata_false_when_thumb_size_missing() {
        // A thumb blob without thumbSize decodes to thumb_size == None, so the
        // completeness predicate returns false.
        let bytes = encode_json(serde_json::json!({
            "version": 1,
            "id": "x",
            "name": "x.jpg",
            "type": "image/jpeg",
            "kind": "thumb",
            "size": 1,
            "hash": "h",
            "thumbForId": "pid",
            "createdAt": 1,
            "updatedAt": 1
        }));
        let decoded = decode_file_metadata(&bytes);
        assert_eq!(decoded.thumb_size, None);
        assert!(!has_complete_thumbnail_metadata(&decoded));
    }

    // A v1 blob with a present wrong-typed catchable base field fails strict v1,
    // then the lenient path rescues it with that field's default and keeps the rest.

    #[test]
    fn decode_v1_wrong_typed_id_catches_to_empty_string_and_keeps_rest() {
        // {id: 123} (number) fails strict (id not string); lenient catches id to ''
        // with every other field populated.
        let bytes = encode_json(serde_json::json!({
            "version": 1,
            "id": 123,
            "name": "x.jpg",
            "type": "image/jpeg",
            "kind": "file",
            "size": 10,
            "hash": "h",
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert_eq!(decoded.id, "");
        assert_eq!(decoded.name, "x.jpg");
        assert_eq!(decoded.type_, "image/jpeg");
        assert_eq!(decoded.size, 10);
        assert_eq!(decoded.hash, "h");
        assert!(matches!(decoded.kind, FileKind::File));
    }

    #[test]
    fn decode_v1_wrong_typed_size_catches_to_zero_and_keeps_rest() {
        // {size: "10"} (string) fails strict; lenient catches size to 0, the rest
        // populated.
        let bytes = encode_json(serde_json::json!({
            "version": 1,
            "id": "f1",
            "name": "x.jpg",
            "type": "image/jpeg",
            "kind": "file",
            "size": "10",
            "hash": "h",
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert_eq!(decoded.size, 0);
        assert_eq!(decoded.id, "f1");
        assert_eq!(decoded.hash, "h");
    }

    #[test]
    fn decode_v1_wrong_typed_kind_catches_to_file() {
        // {kind: 42} fails strict (not 'file'|'thumb'); lenient catches kind to 'file'.
        let bytes = encode_json(serde_json::json!({
            "version": 1,
            "id": "f1",
            "name": "x.jpg",
            "type": "image/jpeg",
            "kind": 42,
            "size": 10,
            "hash": "h",
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert!(matches!(decoded.kind, FileKind::File));
        assert_eq!(decoded.id, "f1");
    }

    #[test]
    fn decode_v1_wrong_typed_optional_with_no_catch_returns_empty() {
        // Optional file fields (tags/directory/trashedAt) have no fallback in
        // either stage, so a present wrong-typed `tags` (string, not string[])
        // fails both strict and lenient -> empty.
        let bytes = encode_json(serde_json::json!({
            "version": 1,
            "id": "f1",
            "name": "x.jpg",
            "type": "image/jpeg",
            "kind": "file",
            "size": 10,
            "hash": "h",
            "tags": "not-an-array",
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert!(decoded.id.is_empty());
        assert!(decoded.hash.is_empty());
    }

    #[test]
    fn decode_v1_wrong_typed_trashed_at_returns_empty() {
        // {trashedAt: "nope"}: a present string is a wrong-typed optional that both
        // stages reject -> empty.
        let bytes = encode_json(serde_json::json!({
            "version": 1,
            "id": "f1",
            "name": "x.jpg",
            "type": "image/jpeg",
            "kind": "file",
            "size": 10,
            "hash": "h",
            "trashedAt": "nope",
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert!(decoded.id.is_empty());
    }

    #[test]
    fn decode_thumb_size_non_numeric_string_returns_empty() {
        // {kind:'thumb', thumbSize:'big'}: strict fails (not 64|512) and lenient
        // rejects the present string -> empty. A numeric out-of-range (128) instead
        // survives via lenient (decode_keeps_out_of_range_thumb_size).
        let bytes = encode_json(serde_json::json!({
            "version": 1,
            "id": "t1",
            "name": "t.webp",
            "type": "image/webp",
            "kind": "thumb",
            "size": 10,
            "hash": "h",
            "thumbForId": "file-1",
            "thumbSize": "big",
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert!(decoded.id.is_empty());
    }

    #[test]
    fn decode_future_version_wrong_typed_optional_returns_empty() {
        // On the future path, the only stage tried is lenient, whose optionals have
        // no fallback. A present wrong-typed one (`thumbForId: 123`, a number) fails
        // it -> logs `future_version_parse_failed` and returns empty.
        let bytes = encode_json(serde_json::json!({
            "version": 2,
            "id": "fut",
            "name": "x.bin",
            "type": "application/octet-stream",
            "kind": "file",
            "size": 100,
            "hash": "h",
            "thumbForId": 123,
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert!(decoded.id.is_empty());
        assert!(decoded.hash.is_empty());
        assert!(matches!(decoded.kind, FileKind::File));
    }

    // The version gate compares `version > MAX_SUPPORTED_VERSION` as a number, so
    // fractional / negative / overflowing versions are ordinary forward-compat
    // numbers, not rejected.

    #[test]
    fn decode_fractional_future_version_uses_lenient_path() {
        // {version: 1.5}: 1.5 > 1 -> future/lenient path -> metadata, not empty.
        let bytes = encode_json(serde_json::json!({
            "version": 1.5,
            "id": "frac",
            "name": "x.bin",
            "type": "application/octet-stream",
            "kind": "file",
            "size": 100,
            "hash": "h",
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert_eq!(decoded.id, "frac");
        assert_eq!(decoded.size, 100);
    }

    #[test]
    fn decode_negative_version_uses_v1_then_lenient_path() {
        // {version: -1}: -1 <= 1 -> strict v1 path; strict fails (version not 1),
        // lenient accepts -1 -> metadata, not empty.
        let bytes = encode_json(serde_json::json!({
            "version": -1,
            "id": "neg",
            "name": "x.bin",
            "type": "application/octet-stream",
            "kind": "file",
            "size": 7,
            "hash": "h",
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert_eq!(decoded.id, "neg");
        assert_eq!(decoded.size, 7);
    }

    #[test]
    fn decode_overflowing_future_version_uses_lenient_path() {
        // {version: 5_000_000_000} (> u32::MAX) is still a number > 1 ->
        // future/lenient path, no integer-width rejection.
        let bytes = encode_json(serde_json::json!({
            "version": 5_000_000_000_i64,
            "id": "big-ver",
            "name": "x.bin",
            "type": "application/octet-stream",
            "kind": "file",
            "size": 3,
            "hash": "h",
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert_eq!(decoded.id, "big-ver");
        assert_eq!(decoded.size, 3);
    }

    #[test]
    fn decode_version_one_point_zero_takes_strict_v1_path() {
        // JSON `1.0` parses to the number 1; `1 > 1` is false, so it takes the
        // strict v1 path and succeeds.
        let bytes = encode_json(serde_json::json!({
            "version": 1.0,
            "id": "v1.0",
            "name": "x.jpg",
            "type": "image/jpeg",
            "kind": "file",
            "size": 9,
            "hash": "h",
            "createdAt": 1,
            "updatedAt": 2
        }));
        let decoded = decode_file_metadata(&bytes);
        assert_eq!(decoded.id, "v1.0");
        assert_eq!(decoded.size, 9);
        assert!(matches!(decoded.kind, FileKind::File));
    }

    #[test]
    fn decode_thumb_size_whole_number_floats_take_strict_v1_path() {
        // 64.0 and 512.0 decode as normal thumbs on the strict path: a whole-number
        // float equals the integer literal, so they don't fall through to lenient.
        for (size, want) in [(64.0, 64), (512.0, 512)] {
            let bytes = encode_json(serde_json::json!({
                "version": 1,
                "id": "thumb-flt",
                "name": "t.webp",
                "type": "image/webp",
                "kind": "thumb",
                "size": 100,
                "hash": "h",
                "thumbForId": "file-1",
                "thumbSize": size,
                "createdAt": 1,
                "updatedAt": 2
            }));
            let raw: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert!(
                parse_strict_v1(&raw).is_ok(),
                "thumbSize {size} must pass strict v1"
            );
            let decoded = decode_file_metadata(&bytes);
            assert!(matches!(decoded.kind, FileKind::Thumb));
            assert_eq!(decoded.thumb_size, Some(want));
        }
    }

    #[test]
    fn decode_thumb_size_fractional_fails_strict_v1() {
        // A fractional value (`64.5`) does not equal the literal 64, so strict v1
        // rejects it. Lenient then accepts it and truncates to 64, but strict
        // fails first.
        let bytes = encode_json(serde_json::json!({
            "version": 1,
            "id": "thumb-frac",
            "name": "t.webp",
            "type": "image/webp",
            "kind": "thumb",
            "size": 100,
            "hash": "h",
            "thumbForId": "file-1",
            "thumbSize": 64.5,
            "createdAt": 1,
            "updatedAt": 2
        }));
        let raw: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(
            parse_strict_v1(&raw).is_err(),
            "thumbSize 64.5 must fail strict v1 (64.5 !== 64)"
        );
    }

    #[test]
    fn encode_emits_the_right_keys_per_kind() {
        // The wire contract is key names and per-kind presence, not order. A file
        // carries the base keys plus tags/directory/trashedAt; a thumb carries the
        // base keys plus thumbForId/thumbSize and none of the file-only keys.
        let file = FileMetadata {
            id: "id-1".into(),
            name: "n".into(),
            type_: "t".into(),
            kind: FileKind::File,
            size: 5,
            hash: "h".into(),
            thumb_for_id: None,
            thumb_size: None,
            tags: Some(vec!["a".into()]),
            directory: Some("d".into()),
            trashed_at: None,
            created_at: 1,
            updated_at: 2,
        };
        let f: serde_json::Value = serde_json::from_slice(&encode_file_metadata(&file)).unwrap();
        assert_eq!(f["version"], serde_json::json!(1));
        assert_eq!(f["type"], serde_json::json!("t"));
        assert_eq!(f["kind"], serde_json::json!("file"));
        assert_eq!(f["tags"], serde_json::json!(["a"]));
        assert_eq!(f["directory"], serde_json::json!("d"));
        assert_eq!(f["trashedAt"], serde_json::Value::Null);
        let fo = f.as_object().unwrap();
        assert!(!fo.contains_key("thumbForId") && !fo.contains_key("thumbSize"));

        let thumb = FileMetadata {
            id: "tid".into(),
            name: "tn".into(),
            type_: "image/webp".into(),
            kind: FileKind::Thumb,
            size: 9,
            hash: "th".into(),
            thumb_for_id: Some("pid".into()),
            thumb_size: Some(512),
            tags: None,
            directory: None,
            trashed_at: None,
            created_at: 3,
            updated_at: 4,
        };
        let t: serde_json::Value = serde_json::from_slice(&encode_file_metadata(&thumb)).unwrap();
        assert_eq!(t["kind"], serde_json::json!("thumb"));
        assert_eq!(t["thumbForId"], serde_json::json!("pid"));
        assert_eq!(t["thumbSize"], serde_json::json!(512));
        let to = t.as_object().unwrap();
        assert!(
            !to.contains_key("tags")
                && !to.contains_key("directory")
                && !to.contains_key("trashedAt")
        );
    }
}
