//! The local object store: each file's indexer objects plus the per-object `needsSyncUp` dirty flag.
//!
//! Objects are keyed `(indexerURL, id)`, so the same id under two indexers is two independent rows
//! and every read and delete is indexer-scoped. The app currently assumes one indexer, but the
//! schema and ops allow for multi-indexer / indexer-migration features in the future.

use std::collections::HashMap;

use rusqlite::{Connection, params, types::Value};

use crate::db::DbError;
use crate::db::sql::{self, InsertConflictClause, UpsertOptions};
use crate::encoding::local_object::{LocalObjectRow, local_object_from_row, local_object_to_row};
use crate::encoding::timestamp::decode_epoch_ms;
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
    let storage = LocalObjectRow {
        id: r.get("id")?,
        file_id: r.get("fileId")?,
        indexer_url: r.get("indexerURL")?,
        slabs: r.get("slabs")?,
        encrypted_data_key: r.get("encryptedDataKey")?,
        encrypted_metadata_key: r.get("encryptedMetadataKey")?,
        encrypted_metadata: r.get("encryptedMetadata")?,
        data_signature: r.get("dataSignature")?,
        metadata_signature: r.get("metadataSignature")?,
        created_at: r.get("createdAt")?,
        updated_at: r.get("updatedAt")?,
    };
    Ok(local_object_from_row(&storage))
}

const OBJECT_REF_COLUMNS: &str = "id, fileId, indexerURL, createdAt, updatedAt";
const OBJECT_ALL_COLUMNS: &str = "id, fileId, indexerURL, createdAt, updatedAt, encryptedDataKey, encryptedMetadataKey, encryptedMetadata, dataSignature, metadataSignature, slabs";

fn query_for_file<T>(
    conn: &Connection,
    columns: &str,
    file_id: &str,
    mapper: impl Fn(&rusqlite::Row) -> rusqlite::Result<T>,
) -> Result<Vec<T>, DbError> {
    let q = format!("SELECT {} FROM objects WHERE fileId = ?", columns);
    let mut stmt = conn.prepare(&q)?;
    let out = stmt
        .query_map(params![file_id], mapper)?
        .collect::<rusqlite::Result<Vec<T>>>()?;
    Ok(out)
}

fn query_for_files<T>(
    conn: &Connection,
    columns: &str,
    file_ids: &[String],
    mapper: impl Fn(&rusqlite::Row) -> rusqlite::Result<T>,
    key: impl Fn(&T) -> String,
) -> Result<HashMap<String, Vec<T>>, DbError> {
    if file_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let q = format!("SELECT {columns} FROM objects WHERE fileId IN rarray(?)");
    let mut stmt = conn.prepare(&q)?;
    let rows = stmt
        .query_map([sql::id_array(file_ids)], mapper)?
        .collect::<rusqlite::Result<Vec<T>>>()?;
    let mut map: HashMap<String, Vec<T>> = HashMap::new();
    for lo in rows {
        map.entry(key(&lo)).or_default().push(lo);
    }
    Ok(map)
}

/// Returns the lightweight object refs (id/file/indexer/timestamps, no slabs or
/// crypto fields) for one file.
pub fn query_object_refs_for_file(
    conn: &Connection,
    file_id: &str,
) -> Result<Vec<LocalObjectRef>, DbError> {
    query_for_file(
        conn,
        OBJECT_REF_COLUMNS,
        file_id,
        local_object_ref_from_db_row,
    )
}

/// Returns the full decoded objects (including slabs and decrypted fields) for one
/// file.
pub fn query_objects_for_file(
    conn: &Connection,
    file_id: &str,
) -> Result<Vec<LocalObject>, DbError> {
    query_for_file(conn, OBJECT_ALL_COLUMNS, file_id, local_object_from_db_row)
}

// Columns updated on a (indexerURL, id) conflict. needsSyncUp is added only when the
// caller sets it (upload); sync-down omits it to preserve a pending flag.
const OBJECT_UPSERT_COLUMNS: [&str; 9] = [
    "fileId",
    "slabs",
    "encryptedDataKey",
    "encryptedMetadataKey",
    "encryptedMetadata",
    "dataSignature",
    "metadataSignature",
    "createdAt",
    "updatedAt",
];

fn object_insert_row(e: &LocalObjectRow, needs_sync_up: i64) -> Vec<(&'static str, Value)> {
    vec![
        ("fileId", Value::Text(e.file_id.clone())),
        ("indexerURL", Value::Text(e.indexer_url.clone())),
        ("id", Value::Text(e.id.clone())),
        ("slabs", Value::Text(e.slabs.clone())),
        (
            "encryptedDataKey",
            Value::Text(e.encrypted_data_key.clone()),
        ),
        (
            "encryptedMetadataKey",
            Value::Text(e.encrypted_metadata_key.clone()),
        ),
        (
            "encryptedMetadata",
            Value::Text(e.encrypted_metadata.clone()),
        ),
        ("dataSignature", Value::Text(e.data_signature.clone())),
        (
            "metadataSignature",
            Value::Text(e.metadata_signature.clone()),
        ),
        ("createdAt", Value::Integer(e.created_at)),
        ("updatedAt", Value::Integer(e.updated_at)),
        ("needsSyncUp", Value::Integer(needs_sync_up)),
    ]
}

/// Upserts one object via `INSERT OR REPLACE`: an existing row is overwritten, not
/// duplicated. Every create/re-upload inserts the object dirty (needsSyncUp = 1), so the
/// next sync-up pass reconciles it.
pub fn insert_object(conn: &Connection, object: &LocalObject) -> Result<(), DbError> {
    let e = local_object_to_row(object);
    sql::insert(
        conn,
        "objects",
        object_insert_row(&e, 1),
        Some(InsertConflictClause::OrReplace),
    )?;
    Ok(())
}

/// Deletes one object row, scoped to (object_id, indexer_url).
pub fn delete_object(conn: &Connection, object_id: &str, indexer_url: &str) -> Result<(), DbError> {
    sql::del(
        conn,
        "objects",
        vec![
            ("id", Value::Text(object_id.to_string())),
            ("indexerURL", Value::Text(indexer_url.to_string())),
        ],
    )?;
    Ok(())
}

/// Returns the number of object rows belonging to one file (across all indexers).
pub fn count_objects_for_file(conn: &Connection, file_id: &str) -> Result<i64, DbError> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM objects WHERE fileId = ?",
        params![file_id],
        |r| r.get(0),
    )?)
}

/// Deletes every object row for one file, regardless of indexer.
pub fn delete_objects_for_file(conn: &Connection, file_id: &str) -> Result<(), DbError> {
    sql::del(
        conn,
        "objects",
        vec![("fileId", Value::Text(file_id.to_string()))],
    )?;
    Ok(())
}

/// Bulk variant of [`query_object_refs_for_file`]: returns lightweight object refs
/// for many files, keyed by file id.
pub fn query_object_refs_for_files(
    conn: &Connection,
    file_ids: &[String],
) -> Result<HashMap<String, Vec<LocalObjectRef>>, DbError> {
    query_for_files(
        conn,
        OBJECT_REF_COLUMNS,
        file_ids,
        local_object_ref_from_db_row,
        |lo| lo.file_id.clone(),
    )
}

/// Bulk variant of [`query_objects_for_file`]: returns full decoded objects for many
/// files, keyed by file id.
pub fn query_objects_for_files(
    conn: &Connection,
    file_ids: &[String],
) -> Result<HashMap<String, Vec<LocalObject>>, DbError> {
    query_for_files(
        conn,
        OBJECT_ALL_COLUMNS,
        file_ids,
        local_object_from_db_row,
        |lo| lo.file_id.clone(),
    )
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

/// Upserts many objects in one statement (metadata refreshed on a `(indexerURL, id)`
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
    let needs_sync_up: i64 = match sync_up {
        NeedsSyncUp::Set => 1,
        NeedsSyncUp::Leave | NeedsSyncUp::Clear => 0,
    };
    let rows: Vec<Vec<(&'static str, Value)>> = objects
        .iter()
        .map(|o| object_insert_row(&local_object_to_row(o), needs_sync_up))
        .collect();
    let mut update_columns: Vec<&'static str> = OBJECT_UPSERT_COLUMNS.to_vec();
    if sync_up != NeedsSyncUp::Leave {
        update_columns.push("needsSyncUp");
    }
    sql::upsert_many(
        conn,
        "objects",
        rows,
        UpsertOptions {
            conflict_column: "indexerURL, id",
            update_columns,
        },
    )?;
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
    sql::run(
        conn,
        r"UPDATE objects SET needsSyncUp = 0
            WHERE id = ? AND indexerURL = ?
              AND (SELECT updatedAt FROM files WHERE files.id = objects.fileId) = ?",
        vec![
            Value::Text(object_id.to_string()),
            Value::Text(indexer_url.to_string()),
            Value::Integer(expected_file_updated_at),
        ],
    )?;
    Ok(())
}

/// Clear the flag on specific objects (sync-down remote-newer winners); scoped to one
/// indexer via the `id IN` list.
pub fn clear_objects_needs_sync_up(
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
pub fn mark_all_objects_needs_sync_up(conn: &Connection) -> Result<(), DbError> {
    sql::run(conn, "UPDATE objects SET needsSyncUp = 1", Vec::new())?;
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
        .query_map(params![indexer_url, limit], |r| {
            Ok(SyncUpObjectRow {
                object_id: r.get("objectId")?,
                file_id: r.get("fileId")?,
                file_name: r.get("fileName")?,
                file_updated_at: r.get("fileUpdatedAt")?,
                deleted_at: r.get("deletedAt")?,
            })
        })?
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

/// Returns the subset of the given file ids that have no object rows (via the
/// `NOT EXISTS` correlated subquery against `objects`).
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

/// Deletes all objects for the given files in one statement.
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

    // The compare-and-swap clear keys off files.updatedAt, so seed a non-zero clock
    // for those tests; query_sync_up_objects also reads files.name.
    fn seed_file_with_updated_at(conn: &Connection, id: &str, updated_at: i64) {
        seed_file_with_name_and_updated_at(conn, id, "", updated_at);
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

    // Builds a test object: empty slabs, small fixed crypto-field byte buffers, and a
    // constant epoch-ms 1000 timestamp.
    fn make_local_object(file_id: &str, indexer_url: &str, object_id: &str) -> LocalObject {
        let ts = Utc.timestamp_millis_opt(1000).unwrap();
        LocalObject {
            id: object_id.into(),
            file_id: file_id.into(),
            indexer_url: indexer_url.into(),
            slabs: Vec::new(),
            encrypted_data_key: vec![0u8; 3],
            encrypted_metadata_key: vec![0u8; 3],
            encrypted_metadata: vec![0u8; 3],
            data_signature: vec![0u8; 2],
            metadata_signature: vec![0u8; 2],
            created_at: ts,
            updated_at: ts,
        }
    }

    #[test]
    fn query_object_refs_for_files_returns_map_keyed_by_file_id_without_slabs() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        seed_file(&conn, "f2");
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        insert_object(&conn, &make_local_object("f2", "https://a.com", "obj2")).unwrap();

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

    #[test]
    fn query_objects_for_files_returns_map_with_slabs_included() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        seed_file(&conn, "f2");
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        insert_object(&conn, &make_local_object("f2", "https://a.com", "obj2")).unwrap();

        let map = query_objects_for_files(&conn, &["f1".into(), "f2".into()]).unwrap();
        assert_eq!(map.get("f1").unwrap().len(), 1);
        assert_eq!(map.get("f1").unwrap()[0].id, "obj1");
        assert!(map.get("f1").unwrap()[0].slabs.is_empty());
        assert_eq!(map.get("f2").unwrap().len(), 1);
        assert_eq!(map.get("f2").unwrap()[0].id, "obj2");
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
    }

    #[test]
    fn upsert_many_objects_empty_is_noop() {
        let conn = migrated_conn();
        upsert_many_objects(&conn, &[], NeedsSyncUp::Set).unwrap();
        // Nothing inserted; an arbitrary lookup stays empty.
        assert!(query_objects_for_file(&conn, "f1").unwrap().is_empty());
    }

    #[test]
    fn upsert_many_objects_on_conflict_overwrites_same_key() {
        // A second upsert of the same key updates rather than duplicates.
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
            NeedsSyncUp::Set,
        )
        .unwrap();
        assert_eq!(count_objects_for_file(&conn, "f1").unwrap(), 1);
    }

    #[test]
    fn upsert_many_objects_with_none_preserves_conflicting_pending_flag() {
        // Leave keeps a conflicting row's pending flag.
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        // Insert dirty (needsSyncUp = 1).
        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj1")],
            NeedsSyncUp::Set,
        )
        .unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);

        // Re-upsert with NeedsSyncUp::Leave: the pending flag must be preserved.
        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj1")],
            NeedsSyncUp::Leave,
        )
        .unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);

        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj1")],
            NeedsSyncUp::Clear,
        )
        .unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 0);
    }

    #[test]
    fn insert_object_creates_flagged() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);
    }

    #[test]
    fn clear_object_if_unchanged_clears_only_when_files_updated_at_matches() {
        let conn = migrated_conn();
        seed_file_with_updated_at(&conn, "f1", 5000);
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);

        // Stale expectation (file's live updatedAt is 5000, not 4000): no-op.
        clear_object_if_unchanged(&conn, "obj1", "https://a.com", 4000).unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);

        clear_object_if_unchanged(&conn, "obj1", "https://a.com", 5000).unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 0);
    }

    #[test]
    fn clear_objects_needs_sync_up_clears_unconditionally() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj2")).unwrap();
        // Same id under a different indexer must not be cleared (indexer-scoped).
        insert_object(&conn, &make_local_object("f1", "https://b.com", "obj1")).unwrap();

        clear_objects_needs_sync_up(&conn, "https://a.com", &["obj1".into()]).unwrap();

        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 0);
        assert_eq!(read_needs_sync_up(&conn, "obj2", "https://a.com"), 1);
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://b.com"), 1);
    }

    #[test]
    fn clear_objects_needs_sync_up_empty_is_noop() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        clear_objects_needs_sync_up(&conn, "https://a.com", &[]).unwrap();
        assert_eq!(read_needs_sync_up(&conn, "obj1", "https://a.com"), 1);
    }

    #[test]
    fn mark_all_objects_needs_sync_up_flags_every_object() {
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

        mark_all_objects_needs_sync_up(&conn).unwrap();

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
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj_b")).unwrap();
        insert_object(&conn, &make_local_object("f2", "https://a.com", "obj_a")).unwrap();
        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj_c")],
            NeedsSyncUp::Clear,
        )
        .unwrap();
        insert_object(&conn, &make_local_object("f1", "https://b.com", "obj_z")).unwrap();

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
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj2")).unwrap();
        upsert_many_objects(
            &conn,
            &[make_local_object("f1", "https://a.com", "obj3")],
            NeedsSyncUp::Clear,
        )
        .unwrap();
        insert_object(&conn, &make_local_object("f1", "https://b.com", "obj4")).unwrap();

        assert_eq!(count_sync_up_objects(&conn, "https://a.com").unwrap(), 2);
        assert_eq!(count_sync_up_objects(&conn, "https://b.com").unwrap(), 1);
    }

    #[test]
    fn delete_many_objects_by_ids_only_targets_matching_indexer() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        insert_object(&conn, &make_local_object("f1", "https://a.com", "shared")).unwrap();
        insert_object(&conn, &make_local_object("f1", "https://b.com", "shared")).unwrap();
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
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        delete_many_objects_by_ids(&conn, &[], "https://a.com").unwrap();
        assert_eq!(count_objects_for_file(&conn, "f1").unwrap(), 1);
    }

    #[test]
    fn delete_object_only_targets_matching_indexer() {
        // delete_object binds both id and indexerURL, so the b.com row with the
        // same id must survive.
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        insert_object(&conn, &make_local_object("f1", "https://a.com", "shared")).unwrap();
        insert_object(&conn, &make_local_object("f1", "https://b.com", "shared")).unwrap();
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
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();

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
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        insert_object(&conn, &make_local_object("f1", "https://b.com", "obj2")).unwrap();

        delete_objects_for_file(&conn, "f1").unwrap();
        assert!(query_object_refs_for_file(&conn, "f1").unwrap().is_empty());
    }

    #[test]
    fn delete_many_objects_for_files_batch_deletes_across_files_leaving_f3() {
        let conn = migrated_conn();
        seed_file(&conn, "f1");
        seed_file(&conn, "f2");
        seed_file(&conn, "f3");
        insert_object(&conn, &make_local_object("f1", "https://a.com", "obj1")).unwrap();
        insert_object(&conn, &make_local_object("f2", "https://a.com", "obj2")).unwrap();
        insert_object(&conn, &make_local_object("f3", "https://a.com", "obj3")).unwrap();

        delete_many_objects_for_files(&conn, &["f1".into(), "f2".into()]).unwrap();

        assert!(query_object_refs_for_file(&conn, "f1").unwrap().is_empty());
        assert!(query_object_refs_for_file(&conn, "f2").unwrap().is_empty());
        assert_eq!(query_object_refs_for_file(&conn, "f3").unwrap().len(), 1);
    }

    #[test]
    fn delete_many_objects_for_files_empty_is_noop() {
        let conn = migrated_conn();
        delete_many_objects_for_files(&conn, &[]).unwrap();
    }
}
