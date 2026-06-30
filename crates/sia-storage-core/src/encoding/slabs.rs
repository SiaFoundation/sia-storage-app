use crate::types::slabs::{PinnedSector, Slab};
use serde::{Deserialize, Serialize};

/// The stored form of a slab: the encryption key is hex, not raw bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlabStorage {
    pub encryption_key: String,
    pub min_shards: u32,
    pub sectors: Vec<PinnedSector>,
    pub offset: u64,
    pub length: u64,
}

fn slab_to_storage(slab: &Slab) -> SlabStorage {
    SlabStorage {
        encryption_key: hex::encode(&slab.encryption_key),
        min_shards: slab.min_shards,
        sectors: slab.sectors.clone(),
        offset: slab.offset,
        length: slab.length,
    }
}

fn slab_from_storage(stored: SlabStorage) -> Result<Slab, hex::FromHexError> {
    Ok(Slab {
        encryption_key: hex::decode(&stored.encryption_key)?,
        min_shards: stored.min_shards,
        sectors: stored.sectors,
        offset: stored.offset,
        length: stored.length,
    })
}

pub fn slabs_to_storage_string(slabs: &[Slab]) -> String {
    let storage: Vec<SlabStorage> = slabs.iter().map(slab_to_storage).collect();
    serde_json::to_string(&storage).expect("slab storage serializes")
}

/// Decode a JSON slab list. One slab with a bad hex key collapses the whole list
/// to `[]`, not just that slab.
pub fn slabs_from_storage_string(stored: &str) -> Vec<Slab> {
    let parsed: Result<Vec<SlabStorage>, _> = serde_json::from_str(stored);
    match parsed {
        Ok(items) => items
            .into_iter()
            .map(slab_from_storage)
            .collect::<Result<Vec<Slab>, _>>()
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_slab() -> Slab {
        Slab {
            encryption_key: vec![1, 2, 3, 4],
            min_shards: 10,
            sectors: vec![
                PinnedSector {
                    root: "abc".into(),
                    host_key: "host-1".into(),
                },
                PinnedSector {
                    root: "def".into(),
                    host_key: "host-2".into(),
                },
            ],
            offset: 0,
            length: 4_194_304,
        }
    }

    #[test]
    fn round_trip_via_storage() {
        let original = sample_slab();
        let s = slabs_to_storage_string(std::slice::from_ref(&original));
        assert!(s.contains("\"encryptionKey\":\"01020304\""));
        let back = slabs_from_storage_string(&s);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].encryption_key, original.encryption_key);
        assert_eq!(back[0].min_shards, original.min_shards);
        assert_eq!(back[0].sectors.len(), 2);
        assert_eq!(back[0].sectors[0].root, "abc");
        assert_eq!(back[0].sectors[1].host_key, "host-2");
        assert_eq!(back[0].offset, original.offset);
        assert_eq!(back[0].length, original.length);
    }

    #[test]
    fn storage_string_field_shape_is_stable() {
        let slab = Slab {
            encryption_key: vec![0xab, 0xcd],
            min_shards: 3,
            sectors: vec![PinnedSector {
                root: "r".into(),
                host_key: "h".into(),
            }],
            offset: 7,
            length: 99,
        };
        let s = slabs_to_storage_string(std::slice::from_ref(&slab));
        assert_eq!(
            s,
            r#"[{"encryptionKey":"abcd","minShards":3,"sectors":[{"root":"r","hostKey":"h"}],"offset":7,"length":99}]"#
        );
    }

    #[test]
    fn invalid_json_returns_empty_vec() {
        let back = slabs_from_storage_string("not json");
        assert!(back.is_empty());
    }

    #[test]
    fn odd_length_hex_key_collapses_whole_list() {
        let json = r#"[
            {"encryptionKey":"01020304","minShards":10,"sectors":[],"offset":0,"length":4194304},
            {"encryptionKey":"abc","minShards":10,"sectors":[],"offset":0,"length":4194304}
        ]"#;
        let back = slabs_from_storage_string(json);
        assert!(
            back.is_empty(),
            "one odd-length-hex key must collapse the whole list to []"
        );
    }

    // An empty string is valid (length-0) hex, so that slab is kept with an empty key.
    #[test]
    fn valid_hex_keys_are_kept() {
        let json = r#"[
            {"encryptionKey":"deadbeef","minShards":2,"sectors":[],"offset":0,"length":8},
            {"encryptionKey":"","minShards":1,"sectors":[],"offset":0,"length":1}
        ]"#;
        let back = slabs_from_storage_string(json);
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].encryption_key, vec![0xde, 0xad, 0xbe, 0xef]);
        assert!(back[1].encryption_key.is_empty());
    }

    #[test]
    fn json_array_round_trip() {
        let slabs = vec![sample_slab(), sample_slab()];
        let s = slabs_to_storage_string(&slabs);
        assert!(s.starts_with('['));
        let back = slabs_from_storage_string(&s);
        assert_eq!(back.len(), 2);
    }

    #[test]
    fn empty_array_round_trips() {
        let s = slabs_to_storage_string(&[]);
        assert_eq!(s, "[]");
        let back = slabs_from_storage_string(&s);
        assert!(back.is_empty());
    }
}
