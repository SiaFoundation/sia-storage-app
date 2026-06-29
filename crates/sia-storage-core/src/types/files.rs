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
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    File,
    Thumb,
}

/// Joined row representation of a file (metadata + local-only fields, no tags).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRecordRow {
    pub id: String,
    pub name: String,
    pub type_: String,
    pub kind: FileKind,
    pub size: u64,
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
