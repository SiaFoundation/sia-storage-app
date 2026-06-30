use std::str::FromStr;

use serde::{Deserialize, Serialize};
use sia_storage::{EncryptionKey, Hash256, PublicKey, Sector, Slab};

/// The stored form of a sector: Merkle root and host key as their string encodings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSector {
    root: String,
    host_key: String,
}

/// The stored form of a slab: encryption key hex, sectors as strings. The exact shape the shared
/// database expects, so the SDK types are converted through this rather than serialized directly
/// (the SDK's own serde is base64 / `ed25519:`-prefixed and would not match on disk).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSlab {
    encryption_key: String,
    min_shards: u8,
    sectors: Vec<StoredSector>,
    offset: u32,
    length: u32,
}

fn slab_to_stored(slab: &Slab) -> StoredSlab {
    StoredSlab {
        encryption_key: hex::encode(slab.encryption_key.as_ref()),
        min_shards: slab.min_shards,
        sectors: slab
            .sectors
            .iter()
            .map(|s| StoredSector {
                root: s.root.to_string(),
                host_key: s.host_key.to_string(),
            })
            .collect(),
        offset: slab.offset,
        length: slab.length,
    }
}

fn slab_from_stored(stored: StoredSlab) -> Option<Slab> {
    let key: [u8; 32] = hex::decode(&stored.encryption_key).ok()?.try_into().ok()?;
    let sectors = stored
        .sectors
        .into_iter()
        .map(|s| {
            Some(Sector {
                root: Hash256::from_str(&s.root).ok()?,
                host_key: PublicKey::from_str(&s.host_key).ok()?,
            })
        })
        .collect::<Option<Vec<Sector>>>()?;
    Some(Slab {
        encryption_key: EncryptionKey::from(key),
        min_shards: stored.min_shards,
        sectors,
        offset: stored.offset,
        length: stored.length,
    })
}

pub fn slabs_to_storage_string(slabs: &[Slab]) -> String {
    let stored: Vec<StoredSlab> = slabs.iter().map(slab_to_stored).collect();
    serde_json::to_string(&stored).expect("slab storage serializes")
}

/// Decode a JSON slab list. Returns `None` on malformed JSON or a bad slab (bad hex, bad
/// root/key) so the caller can reject a corrupt row rather than load empty slabs.
pub fn slabs_from_storage_string(stored: &str) -> Option<Vec<Slab>> {
    let items: Vec<StoredSlab> = serde_json::from_str(stored).ok()?;
    items.into_iter().map(slab_from_stored).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_slab() -> Slab {
        Slab {
            encryption_key: EncryptionKey::from([0xab; 32]),
            min_shards: 10,
            sectors: vec![Sector {
                root: Hash256::from_str(&"cd".repeat(32)).unwrap(),
                host_key: PublicKey::from_str(&format!("ed25519:{}", "ef".repeat(32))).unwrap(),
            }],
            offset: 0,
            length: 4_194_304,
        }
    }

    #[test]
    fn round_trip_via_storage() {
        let original = sample_slab();
        let s = slabs_to_storage_string(std::slice::from_ref(&original));
        let back = slabs_from_storage_string(&s).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(
            back[0].encryption_key.as_ref(),
            original.encryption_key.as_ref()
        );
        assert_eq!(back[0].min_shards, original.min_shards);
        assert_eq!(back[0].sectors[0].root, original.sectors[0].root);
        assert_eq!(back[0].sectors[0].host_key, original.sectors[0].host_key);
        assert_eq!(back[0].offset, original.offset);
        assert_eq!(back[0].length, original.length);
    }

    // The exact on-disk bytes: hex key, camelCase, bare-hex root, ed25519-prefixed host key.
    #[test]
    fn storage_string_field_shape_is_stable() {
        let s = slabs_to_storage_string(std::slice::from_ref(&sample_slab()));
        let expected = format!(
            r#"[{{"encryptionKey":"{}","minShards":10,"sectors":[{{"root":"{}","hostKey":"ed25519:{}"}}],"offset":0,"length":4194304}}]"#,
            "ab".repeat(32),
            "cd".repeat(32),
            "ef".repeat(32),
        );
        assert_eq!(s, expected);
    }

    #[test]
    fn invalid_json_returns_none() {
        assert!(slabs_from_storage_string("not json").is_none());
    }

    #[test]
    fn one_bad_root_returns_none() {
        let json = format!(
            r#"[{{"encryptionKey":"{}","minShards":1,"sectors":[{{"root":"nothex","hostKey":"ed25519:{}"}}],"offset":0,"length":1}}]"#,
            "ab".repeat(32),
            "ef".repeat(32),
        );
        assert!(
            slabs_from_storage_string(&json).is_none(),
            "a bad sector root must reject the whole list"
        );
    }
}
