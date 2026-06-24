use serde::{Deserialize, Serialize};

/// A sector stored on a specific host: its Merkle `root` and the host's `hostKey`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinnedSector {
    pub root: String,
    pub host_key: String,
}

/// One erasure-coded slab of a file: the key that decrypts its data, the minimum
/// sectors needed to recover it, the sectors holding the shards, and its byte
/// offset and length within the file. Stored as JSON in the local database;
/// carried to the indexer inside the object.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Slab {
    pub encryption_key: Vec<u8>,
    pub min_shards: u32,
    pub sectors: Vec<PinnedSector>,
    pub offset: u64,
    pub length: u64,
}
