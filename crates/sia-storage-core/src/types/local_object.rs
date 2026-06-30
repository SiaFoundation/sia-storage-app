use chrono::{DateTime, Utc};
use sia_storage::SealedObject;

/// The local representation of a file's object on the indexer.
#[derive(Debug, Clone)]
pub struct LocalObject {
    pub id: String,
    pub file_id: String,
    pub indexer_url: String,
    pub sealed: SealedObject,
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
