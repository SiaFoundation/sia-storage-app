use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::types::slabs::Slab;

/// A file's full object: its slabs, the encrypted keys and metadata, the data
/// and metadata signatures, and its timestamps. This is the object stored on the
/// indexer; locally it is persisted hex-encoded as a `LocalObjectRow`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalObject {
    pub id: String,
    pub file_id: String,
    pub indexer_url: String,
    pub slabs: Vec<Slab>,
    pub encrypted_data_key: Vec<u8>,
    pub encrypted_metadata_key: Vec<u8>,
    pub encrypted_metadata: Vec<u8>,
    pub data_signature: Vec<u8>,
    pub metadata_signature: Vec<u8>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Slim reference form: identity + indexer + timestamps; omits the heavy
/// crypto/slab fields.
#[derive(Debug, Clone)]
pub struct LocalObjectRef {
    pub id: String,
    pub file_id: String,
    pub indexer_url: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
