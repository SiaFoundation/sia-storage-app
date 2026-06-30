//! The local object store: each file's indexer objects plus the per-object `needsSyncUp` dirty flag.
//!
//! Objects are keyed `(indexerURL, id)`, so the same id under two indexers is two independent rows
//! and every read and delete is indexer-scoped. The app currently assumes one indexer, but the
//! schema and ops allow for multi-indexer / indexer-migration features in the future.

use std::collections::HashMap;
use std::str::FromStr;

use rusqlite::{Connection, params};
use sia_storage::{SealedObject, Signature};

use crate::db::DbError;
use crate::db::sql;
use crate::encoding::slabs::{slabs_from_storage_string, slabs_to_storage_string};
use crate::encoding::timestamp::{decode_epoch_ms, encode_epoch_ms};
use crate::types::local_object::{LocalObject, LocalObjectRef};

fn local_object_ref_from_db_row(r: &rusqlite::Row) -> rusqlite::Result<LocalObjectRef> {
    Ok(LocalObjectRef {
        id: r.get("id")?,
        file_id: r.get("fileId")?,
        indexer_url: r.get("indexerURL")?,
        created_at: decode_epoch_ms(r.get("createdAt")?),
        updated_at: decode_epoch_ms(r.get("updatedAt")?),
    })
}

fn local_object_from_db_row(r: &rusqlite::Row) -> rusqlite::Result<LocalObject> {
    // A stored field that fails to decode means a corrupt row; surface it rather than load a
    // blanked object that fails confusingly at download or decrypt.
    fn corrupt(field: &str) -> rusqlite::Error {
        rusqlite::Error::InvalidColumnType(0, field.to_string(), rusqlite::types::Type::Text)
    }
    let unhex = |col: &'static str, s: String| hex::decode(s).map_err(|_| corrupt(col));
    let sig = |col: &'static str, s: String| Signature::from_str(&s).map_err(|_| corrupt(col));
    Ok(LocalObject {
        id: r.get("id")?,
        file_id: r.get("fileId")?,
        indexer_url: r.get("indexerURL")?,
        sealed: SealedObject {
            encrypted_data_key: unhex("encryptedDataKey", r.get("encryptedDataKey")?)?,
            slabs: slabs_from_storage_string(&r.get::<_, String>("slabs")?)
                .ok_or_else(|| corrupt("slabs"))?,
            data_signature: sig("dataSignature", r.get("dataSignature")?)?,
            encrypted_metadata_key: unhex("encryptedMetadataKey", r.get("encryptedMetadataKey")?)?,
            encrypted_metadata: unhex("encryptedMetadata", r.get("encryptedMetadata")?)?,
            metadata_signature: sig("metadataSignature", r.get("metadataSignature")?)?,
            created_at: decode_epoch_ms(r.get("createdAt")?),
            updated_at: decode_epoch_ms(r.get("updatedAt")?),
        },
    })
}

/// Returns the lightweight object refs (id/file/indexer/timestamps, no slabs or
/// crypto fields) for one file.
pub fn query_object_refs_for_file(
    conn: &Connection,
    file_id: &str,
) -> Result<Vec<LocalObjectRef>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, fileId, indexerURL, createdAt, updatedAt FROM objects WHERE fileId = ?",
    )?;
    let out = stmt
        .query_map(params![file_id], local_object_ref_from_db_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

/// Returns the full decoded objects (slabs plus the still-encrypted crypto fields) for one
/// file.
pub fn query_objects_for_file(
    conn: &Connection,
    file_id: &str,
) -> Result<Vec<LocalObject>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, fileId, indexerURL, createdAt, updatedAt, encryptedDataKey,
                 encryptedMetadataKey, encryptedMetadata, dataSignature, metadataSignature, slabs
          FROM objects WHERE fileId = ?",
    )?;
    let out = stmt
        .query_map(params![file_id], local_object_from_db_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(out)
}

/// Upserts one object via `INSERT OR REPLACE`: an existing row is overwritten, not
/// duplicated. Every create/re-upload inserts the object dirty (needsSyncUp = 1), so the
/// next sync-up pass reconciles it.
pub fn upsert_object(conn: &Connection, o: &LocalObject) -> Result<(), DbError> {
    conn.execute(
        "INSERT OR REPLACE INTO objects (fileId, indexerURL, id, slabs, encryptedDataKey,
            encryptedMetadataKey, encryptedMetadata, dataSignature, metadataSignature,
            createdAt, updatedAt, needsSyncUp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
        params![
            o.file_id,
            o.indexer_url,
            o.id,
            slabs_to_storage_string(&o.sealed.slabs),
            hex::encode(&o.sealed.encrypted_data_key),
            hex::encode(&o.sealed.encrypted_metadata_key),
            hex::encode(&o.sealed.encrypted_metadata),
            o.sealed.data_signature.to_string(),
            o.sealed.metadata_signature.to_string(),
            encode_epoch_ms(o.sealed.created_at),
            encode_epoch_ms(o.sealed.updated_at),
        ],
    )?;
    Ok(())
}

/// Deletes one object row, scoped to (object_id, indexer_url).
pub fn delete_object(conn: &Connection, object_id: &str, indexer_url: &str) -> Result<(), DbError> {
    conn.execute(
        "DELETE FROM objects WHERE id = ? AND indexerURL = ?",
        params![object_id, indexer_url],
    )?;
    Ok(())
}

/// Returns the number of object rows belonging to one file (across all indexers).
/// Consumed by the facade's file-details read (upstack).
pub fn count_objects_for_file(conn: &Connection, file_id: &str) -> Result<i64, DbError> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM objects WHERE fileId = ?",
        params![file_id],
        |r| r.get(0),
    )?)
}

/// Deletes every object row for one file, regardless of indexer. Consumed by the
/// facade's permanent-delete flow (upstack).
pub fn delete_objects_for_file(conn: &Connection, file_id: &str) -> Result<(), DbError> {
    conn.execute("DELETE FROM objects WHERE fileId = ?", params![file_id])?;
    Ok(())
}

/// Bulk variant of [`query_object_refs_for_file`]: returns lightweight object refs
/// for many files, keyed by file id. Consumed by the facade's bulk file reads (upstack).
pub fn query_object_refs_for_files(
    conn: &Connection,
    file_ids: &[String],
) -> Result<HashMap<String, Vec<LocalObjectRef>>, DbError> {
    if file_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let mut stmt = conn.prepare(
        "SELECT id, fileId, indexerURL, createdAt, updatedAt FROM objects
          WHERE fileId IN rarray(?)",
    )?;
    let rows = stmt
        .query_map([sql::id_array(file_ids)], local_object_ref_from_db_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut map: HashMap<String, Vec<LocalObjectRef>> = HashMap::new();
    for lo in rows {
        map.entry(lo.file_id.clone()).or_default().push(lo);
    }
    Ok(map)
}

/// What an object upsert does to the `needsSyncUp` flag on conflict.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NeedsSyncUp {
    /// On conflict, leave the existing `needsSyncUp` untouched (preserve a pending push); a fresh
    /// insert defaults it to 0 (clean).
    Leave,
    /// Set `needsSyncUp = 1` (dirty, needs a remote push).
    Set,
    /// Set `needsSyncUp = 0` (clean, already in sync).
    Clear,
}

impl NeedsSyncUp {
    /// The `needsSyncUp` value written on a fresh insert.
    fn insert_value(self) -> i64 {
        match self {
            NeedsSyncUp::Set => 1,
            NeedsSyncUp::Leave | NeedsSyncUp::Clear => 0,
        }
    }

    /// Whether a conflict overwrites the existing flag; `Leave` preserves a pending push.
    fn updates_flag(self) -> bool {
        self != NeedsSyncUp::Leave
    }
}

/// Upserts many objects with one prepared statement (metadata refreshed on a `(indexerURL, id)`
/// conflict). `sync_up`: upload passes `Set`; sync-down passes `Leave`, which omits
/// `needsSyncUp` from the update set so a conflicting row keeps its pending dirty flag.
pub fn upsert_many_objects(
    conn: &Connection,
    objects: &[LocalObject],
    sync_up: NeedsSyncUp,
) -> Result<(), DbError> {
    if objects.is_empty() {
        return Ok(());
    }
    let update_flag = if sync_up.updates_flag() {
        ", needsSyncUp = excluded.needsSyncUp"
    } else {
        ""
    };
    let mut stmt = conn.prepare(&format!(
        "INSERT INTO objects (fileId, indexerURL, id, slabs, encryptedDataKey,
            encryptedMetadataKey, encryptedMetadata, dataSignature, metadataSignature,
            createdAt, updatedAt, needsSyncUp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(indexerURL, id) DO UPDATE SET
            fileId = excluded.fileId,
            slabs = excluded.slabs,
            encryptedDataKey = excluded.encryptedDataKey,
            encryptedMetadataKey = excluded.encryptedMetadataKey,
            encryptedMetadata = excluded.encryptedMetadata,
            dataSignature = excluded.dataSignature,
            metadataSignature = excluded.metadataSignature,
            createdAt = excluded.createdAt,
            updatedAt = excluded.updatedAt{update_flag}"
    ))?;
    for o in objects {
        stmt.execute(params![
            o.file_id,
            o.indexer_url,
            o.id,
            slabs_to_storage_string(&o.sealed.slabs),
            hex::encode(&o.sealed.encrypted_data_key),
            hex::encode(&o.sealed.encrypted_metadata_key),
            hex::encode(&o.sealed.encrypted_metadata),
            o.sealed.data_signature.to_string(),
            o.sealed.metadata_signature.to_string(),
            encode_epoch_ms(o.sealed.created_at),
            encode_epoch_ms(o.sealed.updated_at),
            sync_up.insert_value(),
        ])?;
    }
    Ok(())
}

/// Flag every object of the given files dirty (the local-mutation entry point).
pub fn flag_objects_for_files(conn: &Connection, file_ids: &[String]) -> Result<(), DbError> {
    if file_ids.is_empty() {
        return Ok(());
    }
    conn.execute(
        "UPDATE objects SET needsSyncUp = 1 WHERE fileId IN rarray(?)",
        [sql::id_array(file_ids)],
    )?;
    Ok(())
}

/// Compare-and-swap clear: clears the flag only if the file's edit clock
/// (files.updatedAt) still matches the value observed before the sync round-trip,
/// so an edit that landed mid-round-trip keeps the object flagged for the next
/// pass. Resolution is updatedAt's millisecond; a second edit within the same
/// millisecond can clear with that edit unpushed.
pub fn clear_object_if_unchanged(
    conn: &Connection,
    object_id: &str,
    indexer_url: &str,
    expected_file_updated_at: i64,
) -> Result<(), DbError> {
    conn.execute(
        r"UPDATE objects SET needsSyncUp = 0
            WHERE id = ? AND indexerURL = ?
              AND (SELECT updatedAt FROM files WHERE files.id = objects.fileId) = ?",
        params![object_id, indexer_url, expected_file_updated_at],
    )?;
    Ok(())
}

/// Clear the flag on specific objects (sync-down remote-newer winners), scoped to one
/// indexer.
pub fn clear_objects(
    conn: &Connection,
    indexer_url: &str,
    object_ids: &[String],
) -> Result<(), DbError> {
    if object_ids.is_empty() {
        return Ok(());
    }
    conn.execute(
        "UPDATE objects SET needsSyncUp = 0 WHERE indexerURL = ? AND id IN rarray(?)",
        params![indexer_url, sql::id_array(object_ids)],
    )?;
    Ok(())
}

/// Flag every object dirty (the advanced "resync metadata" escape hatch).
pub fn flag_all_objects(conn: &Connection) -> Result<(), DbError> {
    conn.execute("UPDATE objects SET needsSyncUp = 1", [])?;
    Ok(())
}

/// One dirty object at an indexer, joined to its file to build the sync-up push:
/// the file's edit clock (`file_updated_at`, for the compare-and-swap clear) and
/// its `deleted_at`, which decides the push, a delete when the file is gone,
/// otherwise an upsert of the object's metadata.
pub struct SyncUpObjectRow {
    pub object_id: String,
    pub file_id: String,
    pub file_name: String,
    pub file_updated_at: i64,
    pub deleted_at: Option<i64>,
}

fn sync_up_object_from_db_row(r: &rusqlite::Row) -> rusqlite::Result<SyncUpObjectRow> {
    Ok(SyncUpObjectRow {
        object_id: r.get("objectId")?,
        file_id: r.get("fileId")?,
        file_name: r.get("fileName")?,
        file_updated_at: r.get("fileUpdatedAt")?,
        deleted_at: r.get("deletedAt")?,
    })
}

/// Dirty objects at the given indexer (one row per push target, so LIMIT
/// bounds work items exactly). Ordered by `o.id`, the index key, not updatedAt.
pub fn query_sync_up_objects(
    conn: &Connection,
    indexer_url: &str,
    limit: i64,
) -> Result<Vec<SyncUpObjectRow>, DbError> {
    let mut stmt = conn.prepare(
        r"SELECT o.id AS objectId, o.fileId AS fileId, f.name AS fileName,
            f.updatedAt AS fileUpdatedAt, f.deletedAt AS deletedAt
          FROM objects o JOIN files f ON f.id = o.fileId
          WHERE o.indexerURL = ? AND o.needsSyncUp = 1
          ORDER BY o.id
          LIMIT ?",
    )?;
    let out = stmt
        .query_map(params![indexer_url, limit], sync_up_object_from_db_row)?
        .collect::<rusqlite::Result<Vec<SyncUpObjectRow>>>()?;
    Ok(out)
}

/// Count of dirty objects at the given indexer (sync-up progress total plus the
/// post-batch "remaining == 0" termination check).
pub fn count_sync_up_objects(conn: &Connection, indexer_url: &str) -> Result<i64, DbError> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM objects WHERE indexerURL = ? AND needsSyncUp = 1",
        params![indexer_url],
        |r| r.get(0),
    )?)
}

/// Deletes many object rows by id, all scoped to a single `indexer_url`.
pub fn delete_many_objects_by_ids(
    conn: &Connection,
    object_ids: &[String],
    indexer_url: &str,
) -> Result<(), DbError> {
    if object_ids.is_empty() {
        return Ok(());
    }
    conn.execute(
        "DELETE FROM objects WHERE indexerURL = ? AND id IN rarray(?)",
        params![indexer_url, sql::id_array(object_ids)],
    )?;
    Ok(())
}

/// Returns the subset of the given file ids that have no object rows.
pub fn query_files_with_no_objects(
    conn: &Connection,
    file_ids: &[String],
) -> Result<Vec<String>, DbError> {
    if file_ids.is_empty() {
        return Ok(Vec::new());
    }
    let q = r"SELECT id FROM files WHERE id IN rarray(?)
              AND NOT EXISTS (SELECT 1 FROM objects WHERE fileId = files.id)";
    let mut stmt = conn.prepare(q)?;
    let out = stmt
        .query_map([sql::id_array(file_ids)], |r| r.get("id"))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(out)
}

/// Deletes all objects for the given files in one statement. Consumed by the facade's
/// bulk permanent-delete flow (upstack).
pub fn delete_many_objects_for_files(
    conn: &Connection,
    file_ids: &[String],
) -> Result<(), DbError> {
    if file_ids.is_empty() {
        return Ok(());
    }
    conn.execute(
        "DELETE FROM objects WHERE fileId IN rarray(?)",
        [sql::id_array(file_ids)],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::migrated_conn;
    use chrono::{TimeZone, Utc};

    fn seed_file(conn: &Connection, id: &str) {
        // The real schema makes name/size/type/hash/addedAt/createdAt/updatedAt
        // NOT NULL with no default; these ops only read `FROM files`, so the
        // values don't matter here: supply 0/'' placeholders.
        seed_file_with_name_and_updated_at(conn, id, "", 0);
    }

    fn seed_file_with_name_and_updated_at(
        conn: &Connection,
        id: &str,
        name: &str,
        updated_at: i64,
    ) {
        conn.execute(
            "INSERT INTO files (id, addedAt, name, size, type, createdAt, updatedAt, hash) \
              VALUES (?, 0, ?, 0, '', 0, ?, '')",
            params![id, name, updated_at],
        )
        .unwrap();
    }

    // Builds a test object with a DISTINCT value in every sealed field, so a swapped
    // bind in the 12-column writes fails the round-trip assertions.
    fn make_local_object(file_id: &str, indexer_url: &str, object_id: &str) -> LocalObject {
        LocalObject {
            id: object_id.into(),
            file_id: file_id.into(),
            indexer_url: indexer_url.into(),
            sealed: SealedObject {
                encrypted_data_key: vec![0x11, 0x12],
                slabs: Vec::new(),
                data_signature: Signature::try_from(&[0x21u8; 64][..]).unwrap(),
                encrypted_metadata_key: vec![0x31, 0x32],
                encrypted_metadata: vec![0x41, 0x42],
                metadata_signature: Signature::try_from(&[0x51u8; 64][..]).unwrap(),
                created_at: Utc.timestamp_millis_opt(1000).unwrap(),
                updated_at: Utc.timestamp_millis_opt(2000).unwrap(),
            },
        }
    }

    #[test]
    fn query_object_refs_for_files_returns_map_keyed_by_file_id_without_slabs() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        seed_file(&conn, "f2");
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        upsert_object(&conn, &make_local_object("f2", "https://a.com", "obj2")).unwrap();

        let map = query_object_refs_for_files(&conn, &["f1".into(), "f2".into()]).unwrap();
        assert_eq!(map.get("f1").unwrap().len(), 1);
        assert_eq!(map.get("f1").unwrap()[0].id, "obj1");
        assert_eq!(map.get("f2").unwrap().len(), 1);
        assert_eq!(map.get("f2").unwrap()[0].id, "obj2");
    }

    #[test]
    fn query_object_refs_for_files_returns_empty_map_for_empty_input() {
        let conn = migrated_conn();
        let map = query_object_refs_for_files(&conn, &[]).unwrap();
        assert!(map.is_empty());
    }

    // Reads back the raw needsSyncUp column for one object (the ops never decode it
    // into LocalObject), so the flag-behavior tests can assert on it directly.
    fn read_needs_sync_up(conn: &Connection, object_id: &str, indexer_url: &str) -> i64 {
        conn.query_row(
            "SELECT needsSyncUp FROM objects WHERE id = ? AND indexerURL = ?",
            params![object_id, indexer_url],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
    }

    #[test]
    fn upsert_many_objects_inserts_all_and_reads_back() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        seed_file(&conn, "f2");
        let objects = vec![
            make_local_object("f1", "https://a.com", "obj1"),
            make_local_object("f1", "https://b.com", "obj2"),
            make_local_object("f2", "https://a.com", "obj3"),
        ];
        upsert_many_objects(&conn, &objects, NeedsSyncUp::Set).unwrap();

        let f1 = query_objects_for_file(&conn, "f1").unwrap();
        assert_eq!(f1.len(), 2);
        let mut f1_ids: Vec<String> = f1.iter().map(|o| o.id.clone()).collect();
        f1_ids.sort();
        assert_eq!(f1_ids, vec!["obj1".to_string(), "obj2".to_string()]);

        let f2 = query_objects_for_file(&conn, "f2").unwrap();
        assert_eq!(f2.len(), 1);
        assert_eq!(f2[0].id, "obj3");
        assert_eq!(f2[0].indexer_url, "https://a.com");

        // Every sealed field round-trips with its distinct fixture value.
        let sealed = &f2[0].sealed;
        assert_eq!(sealed.encrypted_data_key, vec![0x11, 0x12]);
        assert_eq!(sealed.encrypted_metadata_key, vec![0x31, 0x32]);
        assert_eq!(sealed.encrypted_metadata, vec![0x41, 0x42]);
        assert_eq!(
            sealed.data_signature,
            Signature::try_from(&[0x21u8; 64][..]).unwrap()
        );
        assert_eq!(
            sealed.metadata_signature,
            Signature::try_from(&[0x51u8; 64][..]).unwrap()
        );
        assert_eq!(sealed.created_at.timestamp_millis(), 1000);
        assert_eq!(sealed.updated_at.timestamp_millis(), 2000);
    }

    #[test]
    fn upsert_many_objects_empty_is_noop() {
        let conn = migrated_conn();
        upsert_many_objects(&conn, &[], NeedsSyncUp::Set).unwrap();
        assert!(query_objects_for_file(&conn, "f1").unwrap().is_empty());
    }

    #[test]
    fn upsert_many_objects_on_conflict_refreshes_fields_without_duplicating() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj1")],
            NeedsSyncUp::Set,
        )
        .unwrap();
        // Same (indexerURL, id) with changed sealed fields: the DO UPDATE SET must
        // refresh every column, not insert a second row.
        let mut changed = make_local_object("f1", "https://a.com", "obj1");
        changed.sealed.encrypted_data_key = vec![0x99];
        changed.sealed.encrypted_metadata = vec![0x98];
        changed.sealed.updated_at = Utc.timestamp_millis_opt(9000).unwrap();
        upsert_many_objects(&conn, &[changed], NeedsSyncUp::Set).unwrap();

        assert_eq!(count_objects_for_file(&conn, "f1").unwrap(), 1);
        let read = &query_objects_for_file(&conn, "f1").unwrap()[0];
        assert_eq!(read.sealed.encrypted_data_key, vec![0x99]);
        assert_eq!(read.sealed.encrypted_metadata, vec![0x98]);
        assert_eq!(read.sealed.updated_at.timestamp_millis(), 9000);
    }

    #[test]
    fn upsert_many_objects_with_leave_preserves_conflicting_pending_flag() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj1")],
            NeedsSyncUp::Set,
        )
        .unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);

        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj1")],
            NeedsSyncUp::Leave,
        )
        .unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);
    }

    #[test]
    fn upsert_many_objects_with_clear_clears_conflicting_flag() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj1")],
            NeedsSyncUp::Set,
        )
        .unwrap();
        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj1")],
            NeedsSyncUp::Clear,
        )
        .unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 0);
    }

    // Leave on a FRESH insert (no conflicting row) defaults the flag to clean.
    #[test]
    fn upsert_many_objects_with_leave_inserts_fresh_rows_clean() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj1")],
            NeedsSyncUp::Leave,
        )
        .unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 0);
    }

    #[test]
    fn upsert_object_inserts_flagged_and_round_trips() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);

        // upsert_object binds its own 11-column statement (separate from
        // upsert_many_objects), so its fields round-trip too.
        let read = &query_objects_for_file(&conn, "f1").unwrap()[0];
        assert_eq!(read.indexer_url, "https://a.com");
        let sealed = &read.sealed;
        assert_eq!(sealed.encrypted_data_key, vec![0x11, 0x12]);
        assert_eq!(sealed.encrypted_metadata_key, vec![0x31, 0x32]);
        assert_eq!(sealed.encrypted_metadata, vec![0x41, 0x42]);
        assert_eq!(
            sealed.data_signature,
            Signature::try_from(&[0x21u8; 64][..]).unwrap()
        );
        assert_eq!(
            sealed.metadata_signature,
            Signature::try_from(&[0x51u8; 64][..]).unwrap()
        );
        assert_eq!(sealed.created_at.timestamp_millis(), 1000);
        assert_eq!(sealed.updated_at.timestamp_millis(), 2000);
    }

    #[test]
    fn clear_object_if_unchanged_clears_only_when_files_updated_at_matches() {
        let conn = migrated_conn();
        // The compare-and-swap clear keys off files.updatedAt: seed a non-zero clock.
        seed_file_with_name_and_updated_at(&conn, "f1", "", 5000);
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);

        // Stale expectation (file's live updatedAt is 5000, not 4000): no-op.
        clear_object_if_unchanged(&conn, "obj1", "https://a.com", 4000).unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);

        clear_object_if_unchanged(&conn, "obj1", "https://a.com", 5000).unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 0);
    }

    #[test]
    fn clear_objects_clears_unconditionally() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj2")).unwrap();
        // Same id under a different indexer must not be cleared (indexer-scoped).
        upsert_object(&conn, &make_local_object("f1", "https://b.com", "obj1")).unwrap();

        clear_objects(&conn, "https://a.com", &["obj1".into()]).unwrap();

        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 0);
        assert_eq!(read_needs_sync_up(&conn, "obj2", "https://a.com"), 1);
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://b.com"), 1);
    }

    #[test]
    fn clear_objects_empty_is_noop() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        clear_objects(&conn, "https://a.com", &[]).unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);
    }

    #[test]
    fn flag_all_objects_flags_every_object() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        // Insert via upsert with NeedsSyncUp::Clear so both start cleared.
        upsert_many_objects(
            &conn,
            &[
                make_local_object("f1", "https://a.com", "obj1"),
                make_local_object("f1", "https://b.com", "obj2"),
            ],
            NeedsSyncUp::Clear,
        )
        .unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 0);
        assert_eq!(read_needs_sync_up(&conn, "obj2", "https://b.com"), 0);

        flag_all_objects(&conn).unwrap();

        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);
        assert_eq!(read_needs_sync_up(&conn, "obj2", "https://b.com"), 1);
    }

    #[test]
    fn flag_objects_for_files_sets_needs_sync_up() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        seed_file(&conn, "f2");
        // Both start clean (needsSyncUp = 0) via NeedsSyncUp::Clear.
        upsert_many_objects(
            &conn,
            &[
                make_local_object("f1", "https://a.com", "obj1"),
                make_local_object("f2", "https://a.com", "obj2"),
            ],
            NeedsSyncUp::Clear,
        )
        .unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 0);
        assert_eq!(read_needs_sync_up(&conn, "obj2", "https://a.com"), 0);

        flag_objects_for_files(&conn, &["f1".into()]).unwrap();

        // f1's object is flagged; f2's object (a different file) stays clean.
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);
        assert_eq!(read_needs_sync_up(&conn, "obj2", "https://a.com"), 0);
    }

    #[test]
    fn query_sync_up_objects_returns_only_flagged_ordered_by_id() {
        let conn = migrated_conn();
        seed_file_with_name_and_updated_at(&conn, "f1", "name1", 7000);
        seed_file_with_name_and_updated_at(&conn, "f2", "name2", 8000);
        // obj_b and obj_a are flagged for https://a.com; obj_c is cleared; obj_z
        // is on a different indexer.
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj_b")).unwrap();
        upsert_object(&conn, &make_local_object("f2", "https://a.com", "obj_a")).unwrap();
        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj_c")],
            NeedsSyncUp::Clear,
        )
        .unwrap();
        upsert_object(&conn, &make_local_object("f1", "https://b.com", "obj_z")).unwrap();

        let rows = query_sync_up_objects(&conn, "https://a.com", 10).unwrap();
        // Only the two flagged a.com objects, ORDER BY o.id → obj_a before obj_b.
        let ids: Vec<String> = rows.iter().map(|r| r.object_id.clone()).collect();
        assert_eq!(ids, vec!["obj_a".to_string(), "obj_b".to_string()]);
        assert_eq!(rows[0].file_id, "f2");
        assert_eq!(rows[0].file_name, "name2");
        assert_eq!(rows[0].file_updated_at, 8000);
        assert_eq!(rows[0].deleted_at, None);
        assert_eq!(rows[1].file_id, "f1");
        assert_eq!(rows[1].file_name, "name1");
        assert_eq!(rows[1].file_updated_at, 7000);

        // LIMIT bounds the work items.
        let limited = query_sync_up_objects(&conn, "https://a.com", 1).unwrap();
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].object_id, "obj_a");
    }

    #[test]
    fn count_sync_up_objects_counts_flagged_per_indexer() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj2")).unwrap();
        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj3")],
            NeedsSyncUp::Clear,
        )
        .unwrap();
        upsert_object(&conn, &make_local_object("f1", "https://b.com", "obj4")).unwrap();

        assert_eq!(count_sync_up_objects(&conn, "https://a.com").unwrap(), 2);
        assert_eq!(count_sync_up_objects(&conn, "https://b.com").unwrap(), 1);
    }

    #[test]
    fn delete_many_objects_by_ids_only_targets_matching_indexer() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "shared")).unwrap();
        upsert_object(&conn, &make_local_object("f1", "https://b.com", "shared")).unwrap();
        assert_eq!(count_objects_for_file(&conn, "f1").unwrap(), 2);

        delete_many_objects_by_ids(&conn, &["shared".into()], "https://a.com").unwrap();

        // Only the a.com row is gone; the b.com row with the same id survives.
        let remaining = query_object_refs_for_file(&conn, "f1").unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "shared");
        assert_eq!(remaining[0].indexer_url, "https://b.com");
    }

    #[test]
    fn delete_many_objects_by_ids_empty_is_noop() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        delete_many_objects_by_ids(&conn, &[], "https://a.com").unwrap();
        assert_eq!(count_objects_for_file(&conn, "f1").unwrap(), 1);
    }

    #[test]
    fn delete_object_only_targets_matching_indexer() {
        // delete_object binds both id and indexerURL, so the b.com row with the
        // same id must survive.
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "shared")).unwrap();
        upsert_object(&conn, &make_local_object("f1", "https://b.com", "shared")).unwrap();
        assert_eq!(count_objects_for_file(&conn, "f1").unwrap(), 2);

        delete_object(&conn, "shared", "https://a.com").unwrap();

        let remaining = query_object_refs_for_file(&conn, "f1").unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "shared");
        assert_eq!(remaining[0].indexer_url, "https://b.com");
    }

    #[test]
    fn query_files_with_no_objects_returns_files_lacking_objects() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        seed_file(&conn, "f2");
        seed_file(&conn, "f3");
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();

        let mut result =
            query_files_with_no_objects(&conn, &["f1".into(), "f2".into(), "f3".into()]).unwrap();
        result.sort();
        assert_eq!(result, vec!["f2".to_string(), "f3".to_string()]);
    }

    #[test]
    fn query_files_with_no_objects_empty_input_returns_empty() {
        let conn = migrated_conn();
        let result = query_files_with_no_objects(&conn, &[]).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn delete_objects_for_file_deletes_all_objects_for_a_file() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        upsert_object(&conn, &make_local_object("f1", "https://b.com", "obj2")).unwrap();

        delete_objects_for_file(&conn, "f1").unwrap();
        assert!(query_object_refs_for_file(&conn, "f1").unwrap().is_empty());
    }

    #[test]
    fn delete_many_objects_for_files_batch_deletes_across_files_leaving_f3() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        seed_file(&conn, "f2");
        seed_file(&conn, "f3");
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        upsert_object(&conn, &make_local_object("f2", "https://a.com", "obj2")).unwrap();
        upsert_object(&conn, &make_local_object("f3", "https://a.com", "obj3")).unwrap();

        delete_many_objects_for_files(&conn, &["f1".into(), "f2".into()]).unwrap();

        assert!(query_object_refs_for_file(&conn, "f1").unwrap().is_empty());
        assert!(query_object_refs_for_file(&conn, "f2").unwrap().is_empty());
        assert_eq!(query_object_refs_for_file(&conn, "f3").unwrap().len(), 1);
    }

    #[test]
    fn delete_many_objects_for_files_empty_is_noop() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        delete_many_objects_for_files(&conn, &[]).unwrap();
        assert_eq!(count_objects_for_file(&conn, "f1").unwrap(), 1);
    }

    #[test]
    fn flag_objects_for_files_empty_is_noop() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj1")],
            NeedsSyncUp::Clear,
        )
        .unwrap();
        flag_objects_for_files(&conn, &[]).unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 0);
    }
}
