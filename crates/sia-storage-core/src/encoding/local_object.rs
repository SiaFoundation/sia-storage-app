use crate::encoding::slabs::{slabs_from_storage_string, slabs_to_storage_string};
use crate::encoding::timestamp::{decode_epoch_ms, encode_epoch_ms};
use crate::types::slabs::Slab;
use chrono::{DateTime, Utc};

/// A file's full object: its slabs, the encrypted keys and metadata, the data
/// and metadata signatures, and its timestamps. This is the object stored on the
/// indexer; locally it is persisted hex-encoded as a [LocalObjectRow].
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

#[cfg(any(test, feature = "test-fixtures"))]
impl LocalObject {
    /// Test fixture varying only by id/file_id/indexer_url; crypto and slab
    /// fields are fixed placeholders.
    pub fn test(
        id: impl Into<String>,
        file_id: impl Into<String>,
        indexer_url: impl Into<String>,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: id.into(),
            file_id: file_id.into(),
            indexer_url: indexer_url.into(),
            slabs: Vec::new(),
            encrypted_data_key: vec![0u8; 32],
            encrypted_metadata_key: vec![0u8; 32],
            encrypted_metadata: vec![0u8; 16],
            data_signature: vec![0u8; 64],
            metadata_signature: vec![0u8; 64],
            created_at: now,
            updated_at: now,
        }
    }
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

/// DB row form. All bytes are hex strings; timestamps are epoch-ms i64s.
#[derive(Debug, Clone)]
pub struct LocalObjectRow {
    pub id: String,
    pub file_id: String,
    pub indexer_url: String,
    pub slabs: String,
    pub encrypted_data_key: String,
    pub encrypted_metadata_key: String,
    pub encrypted_metadata: String,
    pub data_signature: String,
    pub metadata_signature: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Encode a [LocalObject] to its hex/JSON DB-row form.
pub fn local_object_to_row(lo: &LocalObject) -> LocalObjectRow {
    LocalObjectRow {
        id: lo.id.clone(),
        file_id: lo.file_id.clone(),
        indexer_url: lo.indexer_url.clone(),
        slabs: slabs_to_storage_string(&lo.slabs),
        encrypted_data_key: hex::encode(&lo.encrypted_data_key),
        encrypted_metadata_key: hex::encode(&lo.encrypted_metadata_key),
        encrypted_metadata: hex::encode(&lo.encrypted_metadata),
        data_signature: hex::encode(&lo.data_signature),
        metadata_signature: hex::encode(&lo.metadata_signature),
        created_at: encode_epoch_ms(lo.created_at),
        updated_at: encode_epoch_ms(lo.updated_at),
    }
}

/// Decode a DB row back to a [LocalObject]. A malformed hex field decodes to an
/// empty Vec, so one corrupt row never aborts the whole batch load.
pub fn local_object_from_row(row: &LocalObjectRow) -> LocalObject {
    let dec = |s: &str| hex::decode(s).unwrap_or_default();
    LocalObject {
        id: row.id.clone(),
        file_id: row.file_id.clone(),
        indexer_url: row.indexer_url.clone(),
        slabs: slabs_from_storage_string(&row.slabs),
        encrypted_data_key: dec(&row.encrypted_data_key),
        encrypted_metadata_key: dec(&row.encrypted_metadata_key),
        encrypted_metadata: dec(&row.encrypted_metadata),
        data_signature: dec(&row.data_signature),
        metadata_signature: dec(&row.metadata_signature),
        created_at: decode_epoch_ms(row.created_at),
        updated_at: decode_epoch_ms(row.updated_at),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::slabs::{PinnedSector, Slab};
    use chrono::Utc;

    fn sample() -> LocalObject {
        let now = Utc::now();
        LocalObject {
            id: "obj-1".into(),
            file_id: "file-1".into(),
            indexer_url: "https://indexer".into(),
            slabs: Vec::new(),
            encrypted_data_key: vec![0xab; 32],
            encrypted_metadata_key: vec![0xcd; 32],
            encrypted_metadata: vec![0xef; 16],
            data_signature: vec![0x01; 64],
            metadata_signature: vec![0x02; 64],
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn round_trip_via_storage_row() {
        let original = sample();
        let row = local_object_to_row(&original);
        assert_eq!(row.id, "obj-1");
        assert_eq!(row.file_id, "file-1");
        let back = local_object_from_row(&row);
        assert_eq!(back.id, original.id);
        assert_eq!(back.file_id, original.file_id);
        assert_eq!(back.encrypted_data_key, original.encrypted_data_key);
        assert_eq!(back.encrypted_metadata_key, original.encrypted_metadata_key);
        assert_eq!(back.data_signature, original.data_signature);
    }

    // The basic round-trip uses empty slabs and a sub-ms now(); this one exercises
    // the slabs column and asserts ms-aligned timestamps cleanly.
    #[test]
    fn round_trip_via_storage_row_with_populated_slabs() {
        // ms-aligned so the i64 epoch-ms boundary is lossless (see `encode_epoch_ms`).
        let created_at = decode_epoch_ms(1_700_000_000_000);
        let updated_at = decode_epoch_ms(1_700_000_123_000);
        let original = LocalObject {
            id: "obj-2".into(),
            file_id: "file-2".into(),
            indexer_url: "https://indexer.example".into(),
            slabs: vec![
                Slab {
                    encryption_key: vec![0x10, 0x20, 0x30, 0x40],
                    min_shards: 10,
                    sectors: vec![
                        PinnedSector {
                            root: "root-a".into(),
                            host_key: "host-1".into(),
                        },
                        PinnedSector {
                            root: "root-b".into(),
                            host_key: "host-2".into(),
                        },
                    ],
                    offset: 0,
                    length: 4_194_304,
                },
                Slab {
                    encryption_key: vec![0xaa, 0xbb],
                    min_shards: 3,
                    sectors: Vec::new(),
                    offset: 4_194_304,
                    length: 1_024,
                },
            ],
            encrypted_data_key: vec![0xab; 32],
            encrypted_metadata_key: vec![0xcd; 32],
            encrypted_metadata: vec![0xef; 16],
            data_signature: vec![0x01; 64],
            metadata_signature: vec![0x02; 64],
            created_at,
            updated_at,
        };

        let row = local_object_to_row(&original);
        // The slabs column is the JSON string the DB stores; it must round-trip
        // through `slabs_from_storage_string`, not collapse to [].
        assert!(row.slabs.starts_with('['));
        assert_eq!(row.created_at, 1_700_000_000_000);
        assert_eq!(row.updated_at, 1_700_000_123_000);

        let back = local_object_from_row(&row);
        assert_eq!(back.id, original.id);
        assert_eq!(back.file_id, original.file_id);
        assert_eq!(back.indexer_url, original.indexer_url);
        assert_eq!(back.encrypted_data_key, original.encrypted_data_key);
        assert_eq!(back.encrypted_metadata_key, original.encrypted_metadata_key);
        assert_eq!(back.encrypted_metadata, original.encrypted_metadata);
        assert_eq!(back.data_signature, original.data_signature);
        assert_eq!(back.metadata_signature, original.metadata_signature);
        assert_eq!(back.created_at, created_at);
        assert_eq!(back.updated_at, updated_at);

        assert_eq!(back.slabs.len(), 2);
        assert_eq!(back.slabs[0].encryption_key, vec![0x10, 0x20, 0x30, 0x40]);
        assert_eq!(back.slabs[0].min_shards, 10);
        assert_eq!(back.slabs[0].sectors.len(), 2);
        assert_eq!(back.slabs[0].sectors[0].root, "root-a");
        assert_eq!(back.slabs[0].sectors[0].host_key, "host-1");
        assert_eq!(back.slabs[0].offset, 0);
        assert_eq!(back.slabs[0].length, 4_194_304);
        assert_eq!(back.slabs[1].encryption_key, vec![0xaa, 0xbb]);
        assert_eq!(back.slabs[1].min_shards, 3);
        assert!(back.slabs[1].sectors.is_empty());
        assert_eq!(back.slabs[1].offset, 4_194_304);
        assert_eq!(back.slabs[1].length, 1_024);
    }

    // A malformed hex field decodes to an empty Vec instead of aborting the row
    // load; one corrupt row never poisons the batch.
    #[test]
    fn malformed_hex_fields_decode_to_empty_vec_instead_of_throwing() {
        assert!(hex::decode("abc").is_err()); // odd length
        assert!(hex::decode("zz").is_err()); // non-hex chars

        let original = sample();
        let mut row = local_object_to_row(&original);
        row.encrypted_data_key = "abc".into(); // odd-length hex
        row.encrypted_metadata_key = "zz".into(); // non-hex chars
        row.encrypted_metadata = "xyz".into(); // odd-length + non-hex

        let back = local_object_from_row(&row);
        assert!(back.encrypted_data_key.is_empty());
        assert!(back.encrypted_metadata_key.is_empty());
        assert!(back.encrypted_metadata.is_empty());
        // Well-formed fields are still decoded faithfully.
        assert_eq!(back.data_signature, original.data_signature);
        assert_eq!(back.metadata_signature, original.metadata_signature);
    }
}
