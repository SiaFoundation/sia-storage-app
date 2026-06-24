use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Valid thumbnail sizes in pixels. Variants MUST stay in ascending-size order:
/// derived `Ord` sorts by declaration order, and `.sort()` callers expect
/// ascending pixel order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(into = "i64", try_from = "i64")]
pub enum ThumbSize {
    S64,
    S512,
}

impl From<ThumbSize> for i64 {
    fn from(s: ThumbSize) -> Self {
        match s {
            ThumbSize::S64 => 64,
            ThumbSize::S512 => 512,
        }
    }
}

impl TryFrom<i64> for ThumbSize {
    type Error = String;
    fn try_from(v: i64) -> Result<Self, Self::Error> {
        match v {
            64 => Ok(ThumbSize::S64),
            512 => Ok(ThumbSize::S512),
            _ => Err(format!("invalid thumb size: {}", v)),
        }
    }
}

pub const THUMB_SIZES: &[ThumbSize] = &[ThumbSize::S64, ThumbSize::S512];

/// Whether a record is a primary file or a generated thumbnail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    /// A primary uploaded file.
    File,
    /// A thumbnail generated for a primary file.
    Thumb,
}

/// Fields stored in both the local database and the indexer metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub kind: FileKind,
    pub size: i64,
    pub hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumb_for_id: Option<String>,
    // Raw i64, not the validated `ThumbSize` enum, so an out-of-range value
    // round-trips losslessly instead of being dropped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumb_size: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    pub trashed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl FileMetadata {
    /// All-zero/empty metadata: the safe value `decode_file_metadata` returns on parse failure.
    pub fn empty() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            type_: String::new(),
            kind: FileKind::File,
            size: 0,
            hash: String::new(),
            thumb_for_id: None,
            thumb_size: None,
            tags: None,
            directory: None,
            trashed_at: None,
            created_at: 0,
            updated_at: 0,
        }
    }
}

#[cfg(any(test, feature = "test-fixtures"))]
impl FileMetadata {
    /// Test fixture: constructs a `file`-kind metadata with deterministic
    /// defaults; chain the setters to vary fields.
    pub fn test(id: impl Into<String>) -> Self {
        let id = id.into();
        Self {
            name: format!("{id}.jpg"),
            type_: "image/jpeg".into(),
            kind: FileKind::File,
            size: 100,
            hash: format!("hash-{id}"),
            thumb_for_id: None,
            thumb_size: None,
            tags: None,
            directory: None,
            trashed_at: None,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
            id,
        }
    }
    pub fn name(mut self, v: impl Into<String>) -> Self {
        self.name = v.into();
        self
    }
    pub fn mime(mut self, v: impl Into<String>) -> Self {
        self.type_ = v.into();
        self
    }
    pub fn size(mut self, v: i64) -> Self {
        self.size = v;
        self
    }
    pub fn hash(mut self, v: impl Into<String>) -> Self {
        self.hash = v.into();
        self
    }
    pub fn created_at(mut self, v: i64) -> Self {
        self.created_at = v;
        self
    }
    pub fn updated_at(mut self, v: i64) -> Self {
        self.updated_at = v;
        self
    }
}

/// The exact camelCase key set the sync-up metadata diff compares. `tags` and
/// `directory` are excluded because they live in separate local tables.
pub static FILE_METADATA_WIRE_KEYS: &[&str] = &[
    "id",
    "name",
    "type",
    "kind",
    "size",
    "hash",
    "createdAt",
    "updatedAt",
    "thumbForId",
    "thumbSize",
    "trashedAt",
];

/// Joined row representation of a file (metadata + local-only fields, no tags).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRecordRow {
    pub id: String,
    pub name: String,
    pub type_: String,
    pub kind: FileKind,
    pub size: i64,
    pub hash: String,
    pub thumb_for_id: Option<String>,
    pub thumb_size: Option<ThumbSize>,
    pub trashed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub local_id: Option<String>,
    pub added_at: i64,
    pub deleted_at: Option<i64>,
    pub lost_reason: Option<String>,
}

#[cfg(any(test, feature = "test-fixtures"))]
impl FileRecordRow {
    /// Test fixture: constructs a minimal valid `file`-kind row with
    /// deterministic defaults; chain the setters below to vary fields.
    pub fn test(id: impl Into<String>) -> Self {
        let id = id.into();
        Self {
            name: format!("{id}.jpg"),
            type_: "image/jpeg".into(),
            kind: FileKind::File,
            size: 1024,
            hash: format!("hash-{id}"),
            thumb_for_id: None,
            thumb_size: None,
            trashed_at: None,
            created_at: 1000,
            updated_at: 1000,
            local_id: None,
            added_at: 1000,
            deleted_at: None,
            lost_reason: None,
            id,
        }
    }

    pub fn name(mut self, v: impl Into<String>) -> Self {
        self.name = v.into();
        self
    }
    pub fn mime(mut self, v: impl Into<String>) -> Self {
        self.type_ = v.into();
        self
    }
    pub fn kind(mut self, v: FileKind) -> Self {
        self.kind = v;
        self
    }
    pub fn size(mut self, v: i64) -> Self {
        self.size = v;
        self
    }
    pub fn hash(mut self, v: impl Into<String>) -> Self {
        self.hash = v.into();
        self
    }
    /// The import-placeholder case: a row whose content hash is not yet known.
    pub fn empty_hash(mut self) -> Self {
        self.hash = String::new();
        self
    }
    /// Mark this row as a thumbnail OF `file_id` at `size` (sets kind = Thumb).
    pub fn thumb_for(mut self, file_id: impl Into<String>, size: ThumbSize) -> Self {
        self.kind = FileKind::Thumb;
        self.thumb_for_id = Some(file_id.into());
        self.thumb_size = Some(size);
        self
    }
    pub fn local_id(mut self, v: impl Into<String>) -> Self {
        self.local_id = Some(v.into());
        self
    }
    pub fn trashed_at(mut self, v: i64) -> Self {
        self.trashed_at = Some(v);
        self
    }
    pub fn deleted_at(mut self, v: i64) -> Self {
        self.deleted_at = Some(v);
        self
    }
    pub fn created_at(mut self, v: i64) -> Self {
        self.created_at = v;
        self
    }
    pub fn updated_at(mut self, v: i64) -> Self {
        self.updated_at = v;
        self
    }
    pub fn added_at(mut self, v: i64) -> Self {
        self.added_at = v;
        self
    }
    pub fn lost_reason(mut self, v: impl Into<String>) -> Self {
        self.lost_reason = Some(v.into());
        self
    }
}

/// Domain-level file record with attached local objects.
#[derive(Debug, Clone)]
pub struct FileRecord {
    pub row: FileRecordRow,
    /// Keyed by indexer URL.
    pub objects: HashMap<String, LocalObjectRefDto>,
}

/// The i64-epoch-ms, FFI-facing form of a local-object reference. `transform_row`
/// builds it from the `DateTime`-typed `LocalObjectRef`.
#[derive(Debug, Clone)]
pub struct LocalObjectRefDto {
    pub id: String,
    pub file_id: String,
    pub indexer_url: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pins the wire-key set against the TS app's `fileMetadataKeys`.
    #[test]
    fn file_metadata_keys_match_ts() {
        assert_eq!(
            FILE_METADATA_WIRE_KEYS,
            [
                "id",
                "name",
                "type",
                "kind",
                "size",
                "hash",
                "createdAt",
                "updatedAt",
                "thumbForId",
                "thumbSize",
                "trashedAt",
            ]
        );
        assert!(!FILE_METADATA_WIRE_KEYS.contains(&"tags"));
        assert!(!FILE_METADATA_WIRE_KEYS.contains(&"directory"));
    }
}
