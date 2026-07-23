//! The file store: the `files` table (every version of every file plus thumbnail rows), the
//! per-(name, directoryId) `current`-version pointer, and the reads and mutations that keep
//! them consistent with the local object store.

use std::collections::{HashMap, HashSet};

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value};
use tracing::debug;

use crate::db::DbError;
use crate::db::database::Db;
use crate::db::operations::filter::{BuildRecordFilterOpts, build_record_filter};
use crate::db::operations::local_objects;
use crate::db::sql;
use crate::encoding::timestamp::decode_epoch_ms;
use crate::lib_utils::natural_sort_key::natural_sort_key;
use crate::types::files::{FileKind, FileRecord, FileRecordRow, ThumbSize};
use crate::types::local_object::{LocalObject, LocalObjectRef};

/// An unrecognized `kind` string falls back to `file` rather than erroring. JOIN rows selecting
/// `f.`-prefixed file columns decode too: SQLite exposes an un-`AS`ed column under its bare
/// name.
pub(crate) fn file_record_row_from_db_row(r: &rusqlite::Row) -> rusqlite::Result<FileRecordRow> {
    let kind_str: String = r.get("kind")?;
    let kind = match kind_str.as_str() {
        "thumb" => FileKind::Thumb,
        _ => FileKind::File,
    };
    let thumb_size = r
        .get::<_, Option<i64>>("thumbSize")?
        .and_then(|n| ThumbSize::try_from(n).ok());
    Ok(FileRecordRow {
        id: r.get("id")?,
        name: r.get("name")?,
        type_: r.get("type")?,
        kind,
        size: r.get("size")?,
        hash: r.get("hash")?,
        thumb_for_id: r.get("thumbForId")?,
        thumb_size,
        trashed_at: r.get("trashedAt")?,
        created_at: r.get("createdAt")?,
        updated_at: r.get("updatedAt")?,
        local_id: r.get("localId")?,
        added_at: r.get("addedAt")?,
        deleted_at: r.get("deletedAt")?,
        lost_reason: r.get("lostReason")?,
    })
}

/// The `kind` column's on-disk string.
fn file_kind_str(kind: FileKind) -> &'static str {
    match kind {
        FileKind::File => "file",
        FileKind::Thumb => "thumb",
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameDirGroup {
    pub name: String,
    pub directory_id: Option<String>,
}

fn name_dir_group_from_db_row(r: &rusqlite::Row) -> rusqlite::Result<NameDirGroup> {
    Ok(NameDirGroup {
        name: r.get("name")?,
        directory_id: r.get("directoryId")?,
    })
}

/// The DISTINCT (name, directoryId) groups for the `kind = 'file'` rows among `ids`. (`ids`
/// need not be pre-filtered; the `kind = 'file'` clause scopes it.)
pub(in crate::db) fn query_name_dir_groups(
    conn: &Connection,
    ids: &[String],
) -> Result<Vec<NameDirGroup>, DbError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT DISTINCT name, directoryId FROM files WHERE id IN rarray(?) AND kind = 'file'",
    )?;
    let out = stmt
        .query_map([sql::id_array(ids)], name_dir_group_from_db_row)?
        .collect::<rusqlite::Result<Vec<NameDirGroup>>>()?;
    Ok(out)
}

#[derive(Debug, Clone)]
pub struct UnuploadedFile {
    pub id: String,
    pub name: String,
    pub type_: String,
    pub size: i64,
}

fn unuploaded_file_from_db_row(r: &rusqlite::Row) -> rusqlite::Result<UnuploadedFile> {
    Ok(UnuploadedFile {
        id: r.get("id")?,
        name: r.get("name")?,
        type_: r.get("type")?,
        size: r.get("size")?,
    })
}

#[derive(Debug, Clone)]
pub struct ActiveFileSummary {
    pub id: String,
    pub kind: String,
    pub type_: String,
    pub size: i64,
}

fn active_file_summary_from_db_row(r: &rusqlite::Row) -> rusqlite::Result<ActiveFileSummary> {
    Ok(ActiveFileSummary {
        id: r.get("id")?,
        kind: r.get("kind")?,
        type_: r.get("type")?,
        size: r.get("size")?,
    })
}

/// Predicate behind all three "lost file" queries: lostReason set OR (non-empty hash + no
/// objects on this indexer + no local fs entry). An empty-hash row is never lost via the second
/// rule.
const LOST_PREDICATE_SQL: &str = r"(
       f.lostReason IS NOT NULL
       OR (NOT EXISTS (SELECT 1 FROM objects s WHERE s.fileId = f.id AND s.indexerURL = ?)
           AND NOT EXISTS (SELECT 1 FROM fs fsMeta WHERE fsMeta.fileId = f.id)
           AND f.hash != '')
     )";

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LostFileStats {
    pub count: u64,
    pub total_bytes: i64,
}

/// Domain-level file record carrying full local objects (with slabs), keyed by indexer URL,
/// distinct from `FileRecord`, whose `objects` are the slim ref stubs.
#[derive(Debug, Clone)]
pub struct FileRecordWithObjects {
    pub row: FileRecordRow,
    /// Keyed by indexer URL.
    pub objects: HashMap<String, LocalObject>,
}

/// Decodes one LEFT-JOIN(files, objects) row into its file row plus, when the row carries a
/// matched object (non-null fileId+indexerURL), that object's ref.
fn joined_file_row_from_db_row(
    r: &rusqlite::Row,
) -> rusqlite::Result<(FileRecordRow, Option<LocalObjectRef>)> {
    let file_row = file_record_row_from_db_row(r)?;
    let object = match (
        r.get::<_, Option<String>>("fileId")?,
        r.get::<_, Option<String>>("indexerURL")?,
    ) {
        (Some(file_id), Some(indexer_url)) => Some(LocalObjectRef {
            id: r.get::<_, Option<String>>("objectId")?.unwrap_or_default(),
            file_id,
            indexer_url,
            created_at: decode_epoch_ms(r.get::<_, Option<i64>>("objectCreatedAt")?.unwrap_or(0)),
            updated_at: decode_epoch_ms(r.get::<_, Option<i64>>("objectUpdatedAt")?.unwrap_or(0)),
        }),
        _ => None,
    };
    Ok((file_row, object))
}

/// Group LEFT-JOIN(files, objects) rows into `FileRecord`s. The first row per id wins for the
/// file fields; every matched object contributes a ref. IndexMap preserves first-seen order so
/// the returned Vec matches the JOIN's row order.
fn group_joined_file_rows(joined: Vec<(FileRecordRow, Option<LocalObjectRef>)>) -> Vec<FileRecord> {
    let mut by_id: indexmap::IndexMap<String, FileRecordRow> = indexmap::IndexMap::new();
    let mut objects_by_id: HashMap<String, Vec<LocalObjectRef>> = HashMap::new();
    for (file_row, object) in joined {
        let id = file_row.id.clone();
        by_id.entry(id.clone()).or_insert(file_row);
        if let Some(obj) = object {
            objects_by_id.entry(id).or_default().push(obj);
        }
    }
    by_id
        .into_iter()
        .map(|(id, row)| {
            let objs = objects_by_id.remove(&id);
            transform_row(row, objs)
        })
        .collect()
}

/// Builds the domain `FileRecord` from a row + its object refs, keying objects by indexerURL.
/// The objects are slim ref stubs, NO slabs; use `read_file_with_objects` when the full objects
/// are needed.
pub fn transform_row(row: FileRecordRow, objects: Option<Vec<LocalObjectRef>>) -> FileRecord {
    let mut objects_map: HashMap<String, crate::types::files::LocalObjectRefDto> = HashMap::new();
    if let Some(objs) = objects {
        for o in objs {
            objects_map.insert(
                o.indexer_url.clone(),
                crate::types::files::LocalObjectRefDto {
                    id: o.id,
                    file_id: o.file_id,
                    indexer_url: o.indexer_url,
                    created_at: o.created_at.timestamp_millis(),
                    updated_at: o.updated_at.timestamp_millis(),
                },
            );
        }
    }
    FileRecord {
        row,
        objects: objects_map,
    }
}

/// Whether a file mutation recomputes the per-(name, directory) `current` pointer now, or skips
/// it because a batch caller recomputes once at the end.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CurrentRecalc {
    /// Recompute `current` for the affected groups now.
    #[default]
    Run,
    /// Skip the recompute; the caller does a single batch recalc afterward.
    Skip,
}

#[derive(Debug, Clone, Default)]
pub struct InsertFileOptions {
    pub current_recalc: CurrentRecalc,
}

#[derive(Debug, Clone, Copy)]
pub enum FileQueryOrder {
    Asc,
    Desc,
}

impl FileQueryOrder {
    fn as_str(self) -> &'static str {
        match self {
            FileQueryOrder::Asc => "ASC",
            FileQueryOrder::Desc => "DESC",
        }
    }
}

#[derive(Debug, Clone)]
pub struct FileQueryPinned {
    pub indexer_url: String,
    pub is_pinned: bool,
}

#[derive(Debug, Clone, Default)]
pub struct FileQueryOpts {
    pub limit: Option<u32>,
    pub order: Option<FileQueryOrder>,
    pub pinned: Option<FileQueryPinned>,
    pub file_exists_locally: Option<bool>,
    pub exclude_ids: Option<Vec<String>>,
    pub include_thumbnails: bool,
    pub include_old_versions: bool,
    pub include_trashed: bool,
    pub include_deleted: bool,
    pub hash_empty: bool,
    pub hash_not_empty: bool,
    /// Restrict to rows with no `lostReason`. The import scanner sets this to exclude
    /// terminally-lost placeholders from its candidate pool; without it, lost placeholders are
    /// reconsidered each tick.
    pub lost_reason_is_null: bool,
}

fn build_file_records_query(
    opts: &FileQueryOpts,
    table_alias: &str,
) -> (String, Vec<Value>, String, String) {
    let order = opts.order.unwrap_or(FileQueryOrder::Asc);

    let mut params: Vec<Value> = Vec::new();
    let mut where_clauses: Vec<String> = vec![build_record_filter(
        table_alias,
        BuildRecordFilterOpts {
            include_thumbnails: opts.include_thumbnails,
            include_old_versions: opts.include_old_versions,
            include_trashed: opts.include_trashed,
            include_deleted: opts.include_deleted,
        },
    )];

    if opts.hash_empty {
        where_clauses.push(format!("{table_alias}.hash = ''"));
    }
    if opts.hash_not_empty {
        where_clauses.push(format!("{table_alias}.hash != ''"));
    }
    if opts.lost_reason_is_null {
        where_clauses.push(format!("{table_alias}.lostReason IS NULL"));
    }
    if let Some(p) = &opts.pinned {
        let exists_expr = if p.is_pinned {
            format!(
                "EXISTS (SELECT 1 FROM objects s WHERE s.fileId = {table_alias}.id AND s.indexerURL = ?)"
            )
        } else {
            format!(
                "NOT EXISTS (SELECT 1 FROM objects s WHERE s.fileId = {table_alias}.id AND s.indexerURL = ?)"
            )
        };
        where_clauses.push(exists_expr);
        params.push(Value::Text(p.indexer_url.clone()));
    }
    if let Some(fel) = opts.file_exists_locally {
        let predicate = if fel { "EXISTS" } else { "NOT EXISTS" };
        where_clauses.push(format!(
            "{predicate} (SELECT 1 FROM fs fsMeta WHERE fsMeta.fileId = {table_alias}.id)"
        ));
    }
    if let Some(excl) = &opts.exclude_ids
        && !excl.is_empty()
    {
        where_clauses.push(format!(
            "{table_alias}.id NOT IN ({})",
            sql::placeholders(excl.len())
        ));
        params.extend(excl.iter().cloned().map(Value::Text));
    }
    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };
    let order_expr = format!(
        "{table_alias}.createdAt {ord}, {table_alias}.id {ord}",
        ord = order.as_str()
    );
    let limit_expr = match opts.limit {
        Some(n) => {
            params.push(Value::Integer(i64::from(n)));
            " LIMIT ?".to_string()
        }
        None => String::new(),
    };
    (where_sql, params, order_expr, limit_expr)
}

/// Run a single-group aggregate over `files` with the given SELECT `projection`.
/// The `ORDER BY {order_expr}` is inert on a single-group aggregate (one row, no GROUP BY), but
/// the same builder serves both the aggregates and `query_files`, so it rides along.
fn aggregate_files_query<T>(
    conn: &Connection,
    opts: &FileQueryOpts,
    projection: &str,
    decode: impl FnOnce(&rusqlite::Row) -> rusqlite::Result<T>,
) -> Result<T, DbError> {
    let (where_sql, params, order_expr, limit_expr) = build_file_records_query(opts, "files");
    let q = format!("SELECT {projection} FROM files {where_sql} ORDER BY {order_expr}{limit_expr}");
    Ok(conn.query_row(&q, params_from_iter(params.iter()), decode)?)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStats {
    pub count: u64,
    pub total_bytes: i64,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateFileOptions {
    pub include_updated_at: bool,
    pub current_recalc: CurrentRecalc,
}

#[derive(Debug, Clone, Default)]
pub struct FileUpdate {
    pub id: String,
    pub name: Option<String>,
    pub type_: Option<String>,
    pub kind: Option<FileKind>,
    pub size: Option<i64>,
    pub hash: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
    pub thumb_for_id: Option<Option<String>>,
    pub thumb_size: Option<Option<i64>>,
    pub local_id: Option<Option<String>>,
    pub trashed_at: Option<Option<i64>>,
    pub deleted_at: Option<Option<i64>>,
    pub lost_reason: Option<Option<String>>,
}

/// Whether tombstoning flags the deleted files' objects for sync-up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TombstoneSyncUp {
    /// Flag the objects dirty so sync-up pushes the delete, a locally-originated delete.
    Flag,
    /// Don't flag; the delete already happened remotely (sync-down), so there is nothing to
    /// push.
    AlreadyRemote,
}

/// How a bulk file insert handles an `id` conflict.
#[derive(Debug, Clone, Copy)]
pub enum InsertConflict {
    /// Fail the batch on a duplicate id.
    Fail,
    /// Skip duplicate ids (`INSERT OR IGNORE`), the import dedupe path.
    Ignore,
}

/// Recompute `current` for every group the `kind = 'file'` rows touch (thumbnails never drive
/// currency). A no-op when `current_recalc` is `Skip`.
fn recalc_if_needed(
    conn: &Connection,
    records: &[FileRecordRow],
    current_recalc: CurrentRecalc,
) -> Result<(), DbError> {
    if current_recalc == CurrentRecalc::Skip {
        return Ok(());
    }
    let file_ids: Vec<String> = records
        .iter()
        .filter(|r| matches!(r.kind, FileKind::File))
        .map(|r| r.id.clone())
        .collect();
    recalculate_current_for_file_ids_stmt(conn, &file_ids)
}

/// Recompute the `current` flag for one `(name, directoryId)` group: clear it across the group,
/// then set the single newest row current. Scoping to `kind = 'file'` excludes thumbnails,
/// which carry no `current` of their own (they inherit currency from the original via
/// `thumbForId` at query time).
pub(in crate::db) fn recalculate_current_for_group_stmt(
    conn: &Connection,
    name: &str,
    directory_id: Option<&str>,
) -> Result<(), DbError> {
    // `directoryId IS ?` is SQLite's NULL-safe equality: binding NULL matches the
    // root group, where a plain `=` would match nothing.
    conn.execute(
        r"UPDATE files SET current = 0
          WHERE name = ? AND directoryId IS ? AND kind = 'file'
            AND trashedAt IS NULL AND deletedAt IS NULL AND current = 1",
        params![name, directory_id],
    )?;
    conn.execute(
        r"UPDATE files SET current = 1 WHERE id = (
            SELECT id FROM files
            WHERE name = ? AND directoryId IS ? AND kind = 'file'
              AND trashedAt IS NULL AND deletedAt IS NULL
            ORDER BY updatedAt DESC, id DESC LIMIT 1
          )",
        params![name, directory_id],
    )?;
    Ok(())
}

/// Recalculate `current` for each `(name, directoryId)` group, de-duplicating repeated groups
/// so each is recomputed once.
pub(in crate::db) fn recalculate_current_for_groups_stmt(
    conn: &Connection,
    groups: &[NameDirGroup],
) -> Result<(), DbError> {
    let mut seen: HashSet<(&str, Option<&str>)> = HashSet::new();
    for g in groups {
        if !seen.insert((g.name.as_str(), g.directory_id.as_deref())) {
            continue;
        }
        recalculate_current_for_group_stmt(conn, &g.name, g.directory_id.as_deref())?;
    }
    Ok(())
}

/// Recalculate `current` for every group the given file ids belong to, in two set-based UPDATEs
/// (a `kind = 'file'` group CTE plus a `ROW_NUMBER()` window), the bulk equivalent of looping
/// [`recalculate_current_for_group_stmt`] on the trash/restore hot path.
pub(in crate::db) fn recalculate_current_for_file_ids_stmt(
    conn: &Connection,
    file_ids: &[String],
) -> Result<(), DbError> {
    if file_ids.is_empty() {
        return Ok(());
    }
    // Both UPDATEs join on `f2.directoryId IS g.directoryId`: SQLite's `IS` is a
    // NULL-safe equality, so root-level files (directoryId NULL) match each other
    // instead of dropping out as a plain `=` would.
    conn.execute(
        r"UPDATE files SET current = 0
          WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL
            AND id IN (
              SELECT f2.id FROM files f2
              INNER JOIN (
                SELECT DISTINCT name, directoryId FROM files
                WHERE id IN rarray(?) AND kind = 'file'
              ) g
                ON f2.name = g.name AND f2.directoryId IS g.directoryId
              WHERE f2.kind = 'file' AND f2.trashedAt IS NULL AND f2.deletedAt IS NULL
            )",
        [sql::id_array(file_ids)],
    )?;
    conn.execute(
        r"UPDATE files SET current = 1
          WHERE id IN (
            SELECT id FROM (
              SELECT f2.id, ROW_NUMBER() OVER (
                PARTITION BY f2.name, f2.directoryId
                ORDER BY f2.updatedAt DESC, f2.id DESC
              ) AS rn
              FROM files f2
              INNER JOIN (
                SELECT DISTINCT name, directoryId FROM files
                WHERE id IN rarray(?) AND kind = 'file'
              ) g
                ON f2.name = g.name AND f2.directoryId IS g.directoryId
              WHERE f2.kind = 'file' AND f2.trashedAt IS NULL AND f2.deletedAt IS NULL
            ) sub WHERE sub.rn = 1
          )",
        [sql::id_array(file_ids)],
    )?;
    Ok(())
}

/// The current, non-trashed, non-deleted, `kind = 'file'` row for a bare name (any directory).
/// No explicit LIMIT: `query_row` takes the first ORDER BY row.
pub(in crate::db) fn query_file_by_name_stmt(
    conn: &Connection,
    name: &str,
) -> Result<Option<FileRecordRow>, DbError> {
    let active = build_record_filter("f", BuildRecordFilterOpts::default());
    let sql = format!(
        r"SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt,
                 thumbForId, thumbSize, trashedAt, deletedAt, lostReason
          FROM files f WHERE f.name = ? AND {active}
          ORDER BY f.updatedAt DESC, f.id DESC"
    );
    Ok(conn
        .query_row(&sql, params![name], file_record_row_from_db_row)
        .optional()?)
}

/// The file row owning the given object on one indexer (`LIMIT 1`). No active-set filter,
/// matches by object id regardless of trash/delete state.
pub(in crate::db) fn query_file_by_object_id_stmt(
    conn: &Connection,
    object_id: &str,
    indexer_url: &str,
) -> Result<Option<FileRecordRow>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt,
                 thumbForId, thumbSize, trashedAt, deletedAt, lostReason
              FROM files
              WHERE id IN (SELECT fileId FROM objects WHERE id = ? AND indexerURL = ?) LIMIT 1",
            params![object_id, indexer_url],
            file_record_row_from_db_row,
        )
        .optional()?)
}

/// First non-trashed, non-deleted file row with the given content `hash`, regardless of kind,
/// so it is NOT safe for thumbnail-parent resolution (several files can share a hash). Logs
/// `file_not_found_by_hash` at debug when absent.
pub(in crate::db) fn query_file_by_content_hash_stmt(
    conn: &Connection,
    hash: &str,
) -> Result<Option<FileRecordRow>, DbError> {
    let row = conn
        .query_row(
            "SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt,
                     thumbForId, thumbSize, trashedAt, deletedAt, lostReason
              FROM files WHERE deletedAt IS NULL AND trashedAt IS NULL AND hash = ?",
            params![hash],
            file_record_row_from_db_row,
        )
        .optional()?;
    if row.is_none() {
        debug!(target: "db", hash = hash, "file_not_found_by_hash");
    }
    Ok(row)
}

/// The file row for `id`. No active-set filter, returns the row even if trashed/deleted. Logs
/// `file_not_found` at debug when absent.
pub(in crate::db) fn query_file_by_id_stmt(
    conn: &Connection,
    id: &str,
) -> Result<Option<FileRecordRow>, DbError> {
    let row = conn
        .query_row(
            "SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt,
                     thumbForId, thumbSize, trashedAt, deletedAt, lostReason
              FROM files WHERE id = ?",
            params![id],
            file_record_row_from_db_row,
        )
        .optional()?;
    if row.is_none() {
        debug!(target: "db", id = id, "file_not_found");
    }
    Ok(row)
}

/// Non-trashed, non-deleted file rows matching the given `localId`s (the device-local import
/// identifiers).
pub(in crate::db) fn query_files_by_local_ids_stmt(
    conn: &Connection,
    local_ids: &[String],
) -> Result<Vec<FileRecordRow>, DbError> {
    if local_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt,
                 thumbForId, thumbSize, trashedAt, deletedAt, lostReason
          FROM files WHERE deletedAt IS NULL AND trashedAt IS NULL AND localId IN rarray(?)",
    )?;
    let out = stmt
        .query_map([sql::id_array(local_ids)], file_record_row_from_db_row)?
        .collect::<rusqlite::Result<Vec<FileRecordRow>>>()?;
    Ok(out)
}

/// Current, non-trashed, non-deleted `kind = 'file'` rows matching any of `names` within one
/// directory (`directoryId IS ?`, so `None` targets the unfiled root).
pub(in crate::db) fn query_current_files_by_names_in_directory_stmt(
    conn: &Connection,
    names: &[String],
    directory_id: Option<&str>,
) -> Result<Vec<FileRecordRow>, DbError> {
    if names.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        r"SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt,
                 thumbForId, thumbSize, trashedAt, deletedAt, lostReason
          FROM files
          WHERE name IN rarray(?)
            AND directoryId IS ?
            AND current = 1
            AND trashedAt IS NULL
            AND deletedAt IS NULL
            AND kind = 'file'",
    )?;
    let out = stmt
        .query_map(
            params![sql::id_array(names), directory_id],
            file_record_row_from_db_row,
        )?
        .collect::<rusqlite::Result<Vec<FileRecordRow>>>()?;
    Ok(out)
}

/// Non-trashed, non-deleted file rows whose `hash` is in `content_hashes` (any kind, any
/// version).
pub(in crate::db) fn query_files_by_content_hashes_stmt(
    conn: &Connection,
    content_hashes: &[String],
) -> Result<Vec<FileRecordRow>, DbError> {
    if content_hashes.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt,
                 thumbForId, thumbSize, trashedAt, deletedAt, lostReason
          FROM files WHERE deletedAt IS NULL AND trashedAt IS NULL AND hash IN rarray(?)",
    )?;
    let out = stmt
        .query_map([sql::id_array(content_hashes)], file_record_row_from_db_row)?
        .collect::<rusqlite::Result<Vec<FileRecordRow>>>()?;
    Ok(out)
}

/// All live (not trashed, not deleted) `kind = 'file'` rows sharing this `(name, directoryId)`,
/// newest first, the version stack the current/previous logic ranks over. `None` directory
/// targets the unfiled root. Thumbnails excluded.
pub(in crate::db) fn query_file_versions_stmt(
    conn: &Connection,
    name: &str,
    directory_id: Option<&str>,
) -> Result<Vec<FileRecordRow>, DbError> {
    // `directoryId IS ?` is NULL-safe, so binding NULL targets the unfiled root.
    let mut stmt = conn.prepare(
        r"SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt,
                 thumbForId, thumbSize, trashedAt, deletedAt, lostReason
          FROM files
          WHERE name = ? AND directoryId IS ?
            AND kind = 'file'
            AND trashedAt IS NULL AND deletedAt IS NULL
          ORDER BY updatedAt DESC, id DESC",
    )?;
    let out = stmt
        .query_map(params![name, directory_id], file_record_row_from_db_row)?
        .collect::<rusqlite::Result<Vec<FileRecordRow>>>()?;
    Ok(out)
}

/// Insert one root file row (no directoryId), then, for a `kind = 'file'` row under
/// `CurrentRecalc::Run`, recompute `current` for its group.
pub(in crate::db) fn insert_file_stmt(
    conn: &Connection,
    r: &FileRecordRow,
    options: InsertFileOptions,
) -> Result<(), DbError> {
    // No directoryId: insert_file always creates a root file.
    conn.execute(
        "INSERT INTO files (id, name, nameSortKey, size, createdAt, updatedAt, type, kind,
            localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            r.id,
            r.name,
            natural_sort_key(Some(&r.name)),
            r.size,
            r.created_at,
            r.updated_at,
            r.type_,
            file_kind_str(r.kind),
            r.local_id,
            r.hash,
            r.added_at,
            r.thumb_for_id,
            r.thumb_size.map(i64::from),
            r.trashed_at,
            r.deleted_at,
            r.lost_reason,
        ],
    )?;
    if matches!(r.kind, FileKind::File) && options.current_recalc == CurrentRecalc::Run {
        recalculate_current_for_group_stmt(conn, &r.name, None)?;
    }
    Ok(())
}

/// Update only the `Some` fields of `update`. Sets `updatedAt = now` itself unless
/// `include_updated_at` (then it uses the supplied value), then flags the file's objects for
/// sync-up. Unless `current_recalc` is `Skip`, a change to name/trashedAt/deletedAt/updatedAt
/// recomputes `current` for the old group, and the new group too on a rename.
pub(in crate::db) fn update_file_stmt(
    conn: &Connection,
    update: FileUpdate,
    options: UpdateFileOptions,
) -> Result<(), DbError> {
    let mut assignments: Vec<(&'static str, Value)> = Vec::new();
    if let Some(name) = &update.name {
        assignments.push(("name", Value::Text(name.clone())));
    }
    if let Some(t) = &update.type_ {
        assignments.push(("type", Value::Text(t.clone())));
    }
    if let Some(k) = update.kind {
        assignments.push(("kind", Value::Text(file_kind_str(k).into())));
    }
    if let Some(s) = update.size {
        assignments.push(("size", Value::Integer(s)));
    }
    if let Some(h) = &update.hash {
        assignments.push(("hash", Value::Text(h.clone())));
    }
    if let Some(c) = update.created_at {
        assignments.push(("createdAt", Value::Integer(c)));
    }
    if let Some(t) = &update.thumb_for_id {
        assignments.push(("thumbForId", t.clone().into()));
    }
    if let Some(t) = &update.thumb_size {
        assignments.push(("thumbSize", (*t).into()));
    }
    if let Some(l) = &update.local_id {
        assignments.push(("localId", l.clone().into()));
    }
    if let Some(t) = &update.trashed_at {
        assignments.push(("trashedAt", (*t).into()));
    }
    if let Some(d) = &update.deleted_at {
        assignments.push(("deletedAt", (*d).into()));
    }
    if let Some(r) = &update.lost_reason {
        assignments.push(("lostReason", r.clone().into()));
    }
    if options.include_updated_at
        && let Some(u) = update.updated_at
    {
        assignments.push(("updatedAt", Value::Integer(u)));
    }
    if let Some(name) = &update.name {
        assignments.push(("nameSortKey", natural_sort_key(Some(name)).into()));
    }
    if !options.include_updated_at {
        assignments.push(("updatedAt", Value::Integer(Utc::now().timestamp_millis())));
    }

    let needs_recalc = options.current_recalc == CurrentRecalc::Run
        && (update.name.is_some()
            || update.trashed_at.is_some()
            || update.deleted_at.is_some()
            || update.updated_at.is_some());

    let old_group = if needs_recalc {
        conn.query_row(
            "SELECT name, directoryId FROM files WHERE id = ?",
            params![update.id],
            name_dir_group_from_db_row,
        )
        .optional()?
    } else {
        None
    };

    // include_updated_at with no supplied updatedAt and no other fields leaves nothing
    // to write; the flag below must still run.
    if !assignments.is_empty() {
        let set_clause = assignments
            .iter()
            .map(|(c, _)| format!("{c} = ?"))
            .collect::<Vec<_>>()
            .join(", ");
        let mut values: Vec<Value> = assignments.into_iter().map(|(_, v)| v).collect();
        values.push(Value::Text(update.id.clone()));
        conn.execute(
            &format!("UPDATE files SET {set_clause} WHERE id = ?"),
            params_from_iter(values.iter()),
        )?;
    }
    // Flag even when the only change was the auto-bumped updatedAt: an empty-
    // assignment update (a tag toggle's bare bump) must still mark the row dirty.
    local_objects::flag_objects_for_files_stmt(conn, std::slice::from_ref(&update.id))?;

    if let Some(g) = old_group {
        recalculate_current_for_group_stmt(conn, &g.name, g.directory_id.as_deref())?;
        if let Some(new_name) = update.name.as_ref()
            && new_name != &g.name
        {
            recalculate_current_for_group_stmt(conn, new_name, g.directory_id.as_deref())?;
        }
    }
    Ok(())
}

/// Hard-delete the given files plus any thumbnails pointing at them, then recompute `current`
/// for each affected group. Group keys are captured BEFORE the deletes so the recalc sees the
/// surviving siblings.
pub(in crate::db) fn delete_files_and_thumbnails_stmt(
    conn: &Connection,
    ids: &[String],
) -> Result<(), DbError> {
    if ids.is_empty() {
        return Ok(());
    }
    let groups = query_name_dir_groups(conn, ids)?;
    conn.execute(
        "DELETE FROM files WHERE thumbForId IN rarray(?)",
        [sql::id_array(ids)],
    )?;
    conn.execute(
        "DELETE FROM files WHERE id IN rarray(?)",
        [sql::id_array(ids)],
    )?;
    recalculate_current_for_groups_stmt(conn, &groups)?;
    Ok(())
}

pub(in crate::db) fn tombstone_files_stmt(
    conn: &Connection,
    file_ids: &[String],
    now: i64,
    sync_up: TombstoneSyncUp,
) -> Result<(), DbError> {
    if file_ids.is_empty() {
        return Ok(());
    }
    conn.execute(
        r"UPDATE files SET deletedAt = ?, trashedAt = COALESCE(trashedAt, ?), updatedAt = ?
          WHERE id IN rarray(?) AND deletedAt IS NULL",
        params![now, now, now, sql::id_array(file_ids)],
    )?;
    // Flag ALL passed ids (not just rows the `deletedAt IS NULL` guard touched) so
    // sync-up deletes them remotely.
    if sync_up == TombstoneSyncUp::Flag {
        local_objects::flag_objects_for_files_stmt(conn, file_ids)?;
    }
    Ok(())
}

pub(in crate::db) fn query_directory_ids_for_files_stmt(
    conn: &Connection,
    file_ids: &[String],
) -> Result<Vec<String>, DbError> {
    if file_ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT DISTINCT directoryId FROM files WHERE id IN rarray(?) AND directoryId IS NOT NULL",
    )?;
    let out = stmt
        .query_map([sql::id_array(file_ids)], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(out)
}

pub(in crate::db) fn upsert_many_files_stmt(
    conn: &Connection,
    records: &[FileRecordRow],
    current_recalc: CurrentRecalc,
) -> Result<(), DbError> {
    if records.is_empty() {
        return Ok(());
    }
    let mut stmt = conn.prepare(
        "INSERT INTO files (id, name, nameSortKey, size, createdAt, updatedAt, type, kind,
            localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            nameSortKey = excluded.nameSortKey,
            size = excluded.size,
            type = excluded.type,
            kind = excluded.kind,
            hash = excluded.hash,
            createdAt = excluded.createdAt,
            updatedAt = excluded.updatedAt,
            thumbForId = excluded.thumbForId,
            thumbSize = excluded.thumbSize,
            trashedAt = excluded.trashedAt",
    )?;
    for r in records {
        stmt.execute(params![
            r.id,
            r.name,
            natural_sort_key(Some(&r.name)),
            r.size,
            r.created_at,
            r.updated_at,
            r.type_,
            file_kind_str(r.kind),
            r.local_id,
            r.hash,
            r.added_at,
            r.thumb_for_id,
            r.thumb_size.map(i64::from),
            r.trashed_at,
            r.deleted_at,
            r.lost_reason,
        ])?;
    }
    recalc_if_needed(conn, records, current_recalc)
}

impl Db {
    /// Recompute the `current` flag for one `(name, directoryId)` group: clear it across the
    /// group, then set the single newest row current. Thumbnails are excluded (they carry no
    /// `current` of their own).
    pub async fn recalculate_current_for_group(
        &self,
        name: String,
        directory_id: Option<String>,
    ) -> Result<(), DbError> {
        self.transaction(move |c| {
            recalculate_current_for_group_stmt(c, &name, directory_id.as_deref())
        })
        .await
    }

    /// Recalculate `current` for each `(name, directoryId)` group, de-duplicating repeated
    /// groups so each is recomputed once.
    pub async fn recalculate_current_for_groups(
        &self,
        groups: Vec<NameDirGroup>,
    ) -> Result<(), DbError> {
        self.transaction(move |c| recalculate_current_for_groups_stmt(c, &groups))
            .await
    }

    /// Recalculate `current` for every group the given file ids belong to, in two set-based
    /// UPDATEs, the bulk equivalent of looping the per-group recalc on the trash/restore hot
    /// path.
    pub async fn recalculate_current_for_file_ids(
        &self,
        file_ids: Vec<String>,
    ) -> Result<(), DbError> {
        self.transaction(move |c| recalculate_current_for_file_ids_stmt(c, &file_ids))
            .await
    }

    /// Bulk-fetch file rows by id, keyed by id (no objects attached). Missing ids are simply
    /// absent from the map.
    pub async fn query_files_by_ids(
        &self,
        ids: Vec<String>,
    ) -> Result<HashMap<String, FileRecordRow>, DbError> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        self.transaction(move |c| {
            let mut stmt = c.prepare(
                "SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt,
                         thumbForId, thumbSize, trashedAt, deletedAt, lostReason
                  FROM files WHERE id IN rarray(?)",
            )?;
            let rows = stmt
                .query_map([sql::id_array(&ids)], file_record_row_from_db_row)?
                .collect::<rusqlite::Result<Vec<FileRecordRow>>>()?;
            Ok(rows.into_iter().map(|r| (r.id.clone(), r)).collect())
        })
        .await
    }

    /// Fetch the file rows for the given object ids on one indexer, keyed by objectId (not
    /// fileId) so the caller can map an indexer object back to its file.
    pub async fn query_files_by_object_ids(
        &self,
        object_ids: Vec<String>,
        indexer_url: String,
    ) -> Result<HashMap<String, FileRecordRow>, DbError> {
        if object_ids.is_empty() {
            return Ok(HashMap::new());
        }
        self.transaction(move |c| {
            let mut stmt = c.prepare(
                r"SELECT o.id AS objectId, f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type,
                         f.kind, f.localId, f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt,
                         f.deletedAt, f.lostReason
                  FROM objects o
                  JOIN files f ON f.id = o.fileId
                  WHERE o.indexerURL = ? AND o.id IN rarray(?)",
            )?;
            let rows = stmt
                .query_map(params![indexer_url, sql::id_array(&object_ids)], |r| {
                    Ok((
                        r.get::<_, String>("objectId")?,
                        file_record_row_from_db_row(r)?,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<(String, FileRecordRow)>>>()?;
            Ok(rows.into_iter().collect())
        })
        .await
    }

    /// DISTINCT non-null `directoryId`s the given files belong to.
    pub async fn query_directory_ids_for_files(
        &self,
        file_ids: Vec<String>,
    ) -> Result<Vec<String>, DbError> {
        self.transaction(move |c| query_directory_ids_for_files_stmt(c, &file_ids))
            .await
    }

    /// DISTINCT fileIds with an object record under the given indexer URL. Drives the `ls`
    /// processing/uploaded/local status badge.
    pub async fn query_uploaded_file_ids(
        &self,
        indexer_url: String,
    ) -> Result<Vec<String>, DbError> {
        self.transaction(move |c| {
            let mut stmt = c.prepare("SELECT DISTINCT fileId FROM objects WHERE indexerURL = ?")?;
            let out = stmt
                .query_map(params![indexer_url], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<String>>>()?;
            Ok(out)
        })
        .await
    }

    /// Count of active files with no object record on ANY indexer (not yet uploaded anywhere).
    pub async fn count_unuploaded_files(&self) -> Result<u64, DbError> {
        self.transaction(move |c| {
            let active = build_record_filter("f", BuildRecordFilterOpts::default());
            let sql = format!(
                r"SELECT COUNT(*) FROM files f
                  WHERE {active}
                    AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.fileId = f.id)"
            );
            Ok(c.query_row(&sql, [], |r| r.get(0))?)
        })
        .await
    }

    /// Slim summaries of active files with no object on any indexer, newest-added first.
    pub async fn query_unuploaded_files(&self) -> Result<Vec<UnuploadedFile>, DbError> {
        self.transaction(move |c| {
            let active = build_record_filter("f", BuildRecordFilterOpts::default());
            let sql = format!(
                r"SELECT f.id, f.name, f.type, f.size FROM files f
                  WHERE {active}
                    AND NOT EXISTS (SELECT 1 FROM objects o WHERE o.fileId = f.id)
                  ORDER BY f.addedAt DESC"
            );
            let mut stmt = c.prepare(&sql)?;
            let out = stmt
                .query_map([], unuploaded_file_from_db_row)?
                .collect::<rusqlite::Result<Vec<UnuploadedFile>>>()?;
            Ok(out)
        })
        .await
    }

    /// Slim summaries of every row in the active record set (current, non-trashed,
    /// non-deleted), thumbnails included. No ordering.
    pub async fn query_active_file_summaries(&self) -> Result<Vec<ActiveFileSummary>, DbError> {
        self.transaction(move |c| {
            let active = build_record_filter("f", BuildRecordFilterOpts::default());
            let sql = format!("SELECT f.id, f.kind, f.type, f.size FROM files f WHERE {active}");
            let mut stmt = c.prepare(&sql)?;
            let out = stmt
                .query_map([], active_file_summary_from_db_row)?
                .collect::<rusqlite::Result<Vec<ActiveFileSummary>>>()?;
            Ok(out)
        })
        .await
    }

    /// Count of active "lost" files for one indexer per [`LOST_PREDICATE_SQL`].
    pub async fn count_lost_files(&self, indexer_url: String) -> Result<u64, DbError> {
        self.transaction(move |c| {
            let active = build_record_filter("f", BuildRecordFilterOpts::default());
            let sql = format!(
                r"SELECT COUNT(*) FROM files f
                  WHERE {active}
                  AND {}",
                LOST_PREDICATE_SQL
            );
            Ok(c.query_row(&sql, params![indexer_url], |r| r.get(0))?)
        })
        .await
    }

    /// Count + summed bytes of active "lost" files for one indexer per [`LOST_PREDICATE_SQL`].
    pub async fn query_lost_file_stats(
        &self,
        indexer_url: String,
    ) -> Result<LostFileStats, DbError> {
        self.transaction(move |c| {
            let active = build_record_filter("f", BuildRecordFilterOpts::default());
            let sql = format!(
                r"SELECT COUNT(*), COALESCE(SUM(size), 0) FROM files f
                  WHERE {active}
                  AND {}",
                LOST_PREDICATE_SQL
            );
            Ok(c.query_row(&sql, params![indexer_url], |r| {
                Ok(LostFileStats {
                    count: r.get(0)?,
                    total_bytes: r.get(1)?,
                })
            })?)
        })
        .await
    }

    /// Active "lost" file rows for one indexer per [`LOST_PREDICATE_SQL`], newest-added first.
    pub async fn query_lost_files(
        &self,
        indexer_url: String,
    ) -> Result<Vec<FileRecordRow>, DbError> {
        self.transaction(move |c| {
            let active = build_record_filter("f", BuildRecordFilterOpts::default());
            let sql = format!(
                r"SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt,
                         thumbForId, thumbSize, trashedAt, deletedAt, lostReason
                  FROM files f
                  WHERE {active}
                  AND {}
                  ORDER BY f.addedAt DESC",
                LOST_PREDICATE_SQL
            );
            let mut stmt = c.prepare(&sql)?;
            let out = stmt
                .query_map(params![indexer_url], file_record_row_from_db_row)?
                .collect::<rusqlite::Result<Vec<FileRecordRow>>>()?;
            Ok(out)
        })
        .await
    }

    /// The current, non-trashed, non-deleted, `kind = 'file'` row for a bare name (any
    /// directory).
    pub async fn query_file_by_name(&self, name: String) -> Result<Option<FileRecordRow>, DbError> {
        self.transaction(move |c| query_file_by_name_stmt(c, &name))
            .await
    }

    /// `query_file_by_name` plus the file's object refs (keyed by indexerURL).
    pub async fn read_file_by_name(&self, name: String) -> Result<Option<FileRecord>, DbError> {
        self.transaction(move |c| {
            let Some(row) = query_file_by_name_stmt(c, &name)? else {
                return Ok(None);
            };
            let objects = local_objects::query_object_refs_for_file_stmt(c, &row.id)?;
            Ok(Some(transform_row(row, Some(objects))))
        })
        .await
    }

    /// Same as `read_file_by_name` but constrained to the unfiled root (`directoryId IS NULL`).
    pub async fn read_file_by_name_in_unfiled(
        &self,
        name: String,
    ) -> Result<Option<FileRecord>, DbError> {
        self.transaction(move |c| {
            let active = build_record_filter("f", BuildRecordFilterOpts::default());
            let sql = format!(
                r"SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt,
                         thumbForId, thumbSize, trashedAt, deletedAt, lostReason
                  FROM files f
                  WHERE f.name = ? AND f.directoryId IS NULL AND {active}
                  ORDER BY f.updatedAt DESC, f.id DESC
                  LIMIT 1"
            );
            let Some(row) = c
                .query_row(&sql, params![name], file_record_row_from_db_row)
                .optional()?
            else {
                return Ok(None);
            };
            let objects = local_objects::query_object_refs_for_file_stmt(c, &row.id)?;
            Ok(Some(transform_row(row, Some(objects))))
        })
        .await
    }

    /// `query_file_by_id` plus the file's object refs (keyed by indexerURL).
    pub async fn read_file(&self, id: String) -> Result<Option<FileRecord>, DbError> {
        self.transaction(move |c| {
            let Some(row) = query_file_by_id_stmt(c, &id)? else {
                return Ok(None);
            };
            let objects = local_objects::query_object_refs_for_file_stmt(c, &id)?;
            Ok(Some(transform_row(row, Some(objects))))
        })
        .await
    }

    /// `query_file_by_id` plus `query_objects_for_file` (full objects WITH slabs, unlike
    /// `read_file`'s slim refs). Objects keyed by indexerURL.
    pub async fn read_file_with_objects(
        &self,
        id: String,
    ) -> Result<Option<FileRecordWithObjects>, DbError> {
        self.transaction(move |c| {
            let Some(row) = query_file_by_id_stmt(c, &id)? else {
                return Ok(None);
            };
            let objects = local_objects::query_objects_for_file_stmt(c, &id)?;
            let objects = objects
                .into_iter()
                .map(|o| (o.indexer_url.clone(), o))
                .collect();
            Ok(Some(FileRecordWithObjects { row, objects }))
        })
        .await
    }

    /// `query_file_by_object_id` plus the file's object refs (keyed by indexerURL).
    pub async fn read_file_by_object_id(
        &self,
        object_id: String,
        indexer_url: String,
    ) -> Result<Option<FileRecord>, DbError> {
        self.transaction(move |c| {
            let Some(row) = query_file_by_object_id_stmt(c, &object_id, &indexer_url)? else {
                return Ok(None);
            };
            let objects = local_objects::query_object_refs_for_file_stmt(c, &row.id)?;
            Ok(Some(transform_row(row, Some(objects))))
        })
        .await
    }

    /// `query_file_by_content_hash` plus the file's object refs (keyed by indexerURL).
    pub async fn read_file_by_content_hash(
        &self,
        hash: String,
    ) -> Result<Option<FileRecord>, DbError> {
        self.transaction(move |c| {
            let Some(row) = query_file_by_content_hash_stmt(c, &hash)? else {
                return Ok(None);
            };
            let objects = local_objects::query_object_refs_for_file_stmt(c, &row.id)?;
            Ok(Some(transform_row(row, Some(objects))))
        })
        .await
    }

    /// `query_files_by_local_ids` plus `transform_row` per row, NO objects attached.
    pub async fn read_files_by_local_ids(
        &self,
        local_ids: Vec<String>,
    ) -> Result<Vec<FileRecord>, DbError> {
        self.transaction(move |c| {
            let rows = query_files_by_local_ids_stmt(c, &local_ids)?;
            Ok(rows
                .into_iter()
                .map(|row| transform_row(row, None))
                .collect())
        })
        .await
    }

    /// `query_current_files_by_names_in_directory` plus `transform_row` per row, NO objects
    /// attached.
    pub async fn read_current_files_by_names_in_directory(
        &self,
        names: Vec<String>,
        directory_id: Option<String>,
    ) -> Result<Vec<FileRecord>, DbError> {
        self.transaction(move |c| {
            let rows =
                query_current_files_by_names_in_directory_stmt(c, &names, directory_id.as_deref())?;
            Ok(rows
                .into_iter()
                .map(|row| transform_row(row, None))
                .collect())
        })
        .await
    }

    /// `query_files_by_content_hashes` plus `transform_row` per row, NO objects attached.
    pub async fn read_files_by_content_hashes(
        &self,
        content_hashes: Vec<String>,
    ) -> Result<Vec<FileRecord>, DbError> {
        self.transaction(move |c| {
            let rows = query_files_by_content_hashes_stmt(c, &content_hashes)?;
            Ok(rows
                .into_iter()
                .map(|row| transform_row(row, None))
                .collect())
        })
        .await
    }

    /// No ORDER BY and no LIMIT (unlike `query_files`), so the JOIN-row count never splits a
    /// file's objects across a limit boundary.
    pub async fn read_files_by_ids(&self, ids: Vec<String>) -> Result<Vec<FileRecord>, DbError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        self.transaction(move |c| {
            let mut stmt = c.prepare(
                r"SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind, f.localId,
                         f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt, f.deletedAt, f.lostReason,
                         o.fileId as fileId, o.indexerURL as indexerURL, o.id as objectId,
                         o.createdAt as objectCreatedAt, o.updatedAt as objectUpdatedAt
                  FROM files f
                  LEFT JOIN objects o ON o.fileId = f.id
                  WHERE f.id IN rarray(?)",
            )?;
            let joined = stmt
                .query_map([sql::id_array(&ids)], joined_file_row_from_db_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(group_joined_file_rows(joined))
        })
        .await
    }

    /// Renames all versions of a file (records sharing the same name and directory), returning
    /// ids of touched rows. Staggered `updatedAt` (the current version gets `now`, the next
    /// `now - 1ms`, …) bumps every row to trigger sync-up while keeping relative version order.
    pub async fn rename_all_file_versions(
        &self,
        current_name: String,
        directory_id: Option<String>,
        new_name: String,
    ) -> Result<Vec<String>, DbError> {
        self.transaction(move |c| {
            let versions = query_file_versions_stmt(c, &current_name, directory_id.as_deref())?;
            if versions.is_empty() {
                return Ok(Vec::new());
            }
            let now = Utc::now().timestamp_millis();
            let sort_key = natural_sort_key(Some(&new_name));
            let mut stmt = c.prepare(
                "UPDATE files SET name = ?, nameSortKey = ?, updatedAt = ? WHERE id = ?",
            )?;
            for (i, v) in versions.iter().enumerate() {
                stmt.execute(params![new_name, sort_key, now - i as i64, v.id])?;
            }
            let ids: Vec<String> = versions.iter().map(|v| v.id.clone()).collect();
            local_objects::flag_objects_for_files_stmt(c, &ids)?;
            recalculate_current_for_group_stmt(c, &new_name, directory_id.as_deref())?;
            Ok(ids)
        })
        .await
    }

    /// Moves all versions of a file to a new directory, returning ids of touched rows.
    /// Staggered decreasing `updatedAt` preserves relative version order while bumping every
    /// row to trigger sync-up (see `rename_all_file_versions`).
    pub async fn move_all_file_versions(
        &self,
        name: String,
        from_directory_id: Option<String>,
        to_directory_id: Option<String>,
    ) -> Result<Vec<String>, DbError> {
        self.transaction(move |c| {
            let versions = query_file_versions_stmt(c, &name, from_directory_id.as_deref())?;
            if versions.is_empty() {
                return Ok(Vec::new());
            }
            let now = Utc::now().timestamp_millis();
            let mut stmt =
                c.prepare("UPDATE files SET directoryId = ?, updatedAt = ? WHERE id = ?")?;
            for (i, v) in versions.iter().enumerate() {
                stmt.execute(params![to_directory_id, now - i as i64, v.id])?;
            }
            let ids: Vec<String> = versions.iter().map(|v| v.id.clone()).collect();
            local_objects::flag_objects_for_files_stmt(c, &ids)?;
            recalculate_current_for_group_stmt(c, &name, to_directory_id.as_deref())?;
            Ok(ids)
        })
        .await
    }

    /// Moves every version of each given file's stack to a new directory. Each id identifies
    /// its stack by (name, directoryId); all versions sharing that identity move together, so a
    /// bulk move never splits a version history. A single strictly-decreasing `updatedAt` stamp
    /// across ALL stacks (not a per-stack `now()` baseline) makes a cross-stack same-name merge
    /// deterministically pick the globally-newest version as current.
    pub async fn move_files_all_versions(
        &self,
        file_ids: Vec<String>,
        to_directory_id: Option<String>,
    ) -> Result<Vec<String>, DbError> {
        if file_ids.is_empty() {
            return Ok(Vec::new());
        }
        self.transaction(move |c| {
            // Every active version of every selected stack, newest-first, in one query.
            // `f.directoryId IS g.directoryId` is null-safe, so unfiled stacks match too.
            let ids: Vec<String> = {
                let mut stmt = c.prepare(
                    r"SELECT f.id FROM files f
                      JOIN (SELECT DISTINCT name, directoryId FROM files WHERE id IN rarray(?) AND kind = 'file') g
                        ON f.name = g.name AND f.directoryId IS g.directoryId
                      WHERE f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL
                      ORDER BY f.updatedAt DESC, f.id DESC",
                )?;
                stmt.query_map([sql::id_array(&file_ids)], |r| r.get(0))?
                    .collect::<rusqlite::Result<Vec<String>>>()?
            };
            let mut stamp = Utc::now().timestamp_millis();
            let mut moved_ids: Vec<String> = Vec::with_capacity(ids.len());
            let mut stmt =
                c.prepare("UPDATE files SET directoryId = ?, updatedAt = ? WHERE id = ?")?;
            for id in ids {
                stmt.execute(params![to_directory_id, stamp, id])?;
                stamp -= 1;
                moved_ids.push(id);
            }
            local_objects::flag_objects_for_files_stmt(c, &moved_ids)?;
            recalculate_current_for_file_ids_stmt(c, &moved_ids)?;
            Ok(moved_ids)
        })
        .await
    }

    /// Hard-delete every active "lost" file (and its thumbnails) for one indexer, returning the
    /// count deleted. Includes old versions, not just the current one.
    pub async fn delete_lost_files_and_thumbnails(
        &self,
        indexer_url: String,
    ) -> Result<u64, DbError> {
        self.transaction(move |c| {
            let active = build_record_filter(
                "f",
                BuildRecordFilterOpts {
                    include_old_versions: true,
                    ..Default::default()
                },
            );
            let sql = format!(
                r"SELECT f.id FROM files f
                  WHERE f.kind = 'file' AND {active}
                  AND {}",
                LOST_PREDICATE_SQL
            );
            let ids: Vec<String> = {
                let mut stmt = c.prepare(&sql)?;
                stmt.query_map(params![indexer_url], |r| r.get(0))?
                    .collect::<rusqlite::Result<Vec<String>>>()?
            };
            let total = ids.len() as u64;
            delete_files_and_thumbnails_stmt(c, &ids)?;
            Ok(total)
        })
        .await
    }

    /// Insert one root file row (no directoryId); for a `kind = 'file'` row under
    /// `CurrentRecalc::Run`, recompute `current` for its group so the new version wins.
    pub async fn insert_file(
        &self,
        r: FileRecordRow,
        options: InsertFileOptions,
    ) -> Result<(), DbError> {
        self.transaction(move |c| insert_file_stmt(c, &r, options))
            .await
    }

    /// `COUNT(*)` over `files` filtered by `opts`. No JOIN, counts files, not JOIN rows.
    pub async fn count_files(&self, opts: FileQueryOpts) -> Result<u64, DbError> {
        self.transaction(move |c| aggregate_files_query(c, &opts, "COUNT(*)", |r| r.get(0)))
            .await
    }

    /// `COUNT(*)` + `SUM(size)` over `files` filtered by `opts`. No JOIN; `SUM` coalesces to 0
    /// on an empty set.
    pub async fn query_file_stats(&self, opts: FileQueryOpts) -> Result<FileStats, DbError> {
        self.transaction(move |c| {
            aggregate_files_query(c, &opts, "COUNT(*), COALESCE(SUM(size), 0)", |r| {
                Ok(FileStats {
                    count: r.get(0)?,
                    total_bytes: r.get(1)?,
                })
            })
        })
        .await
    }

    /// Query files (each with its object refs keyed by indexerURL), filtered, ordered, and
    /// limited by `opts`.
    /// `LIMIT` counts files: it applies inside a files-only subquery BEFORE the objects JOIN,
    /// so a file's objects can never be split across a page boundary.
    pub async fn query_files(&self, opts: FileQueryOpts) -> Result<Vec<FileRecord>, DbError> {
        self.transaction(move |c| {
            let (where_sql, params, order_expr, limit_expr) = build_file_records_query(&opts, "f");
            let q = format!(
                r"SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind, f.localId,
                         f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt, f.deletedAt, f.lostReason,
                         o.fileId as fileId, o.indexerURL as indexerURL, o.id as objectId,
                         o.createdAt as objectCreatedAt, o.updatedAt as objectUpdatedAt
                  FROM (
                    SELECT id, name, size, createdAt, updatedAt, type, kind, localId, hash, addedAt,
                           thumbForId, thumbSize, trashedAt, deletedAt, lostReason
                    FROM files f
                    {where_sql}
                    ORDER BY {order_expr}{limit_expr}
                  ) f
                  LEFT JOIN objects o ON o.fileId = f.id
                  ORDER BY {order_expr}"
            );
            let mut stmt = c.prepare(&q)?;
            let joined = stmt
                .query_map(params_from_iter(params.iter()), joined_file_row_from_db_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(group_joined_file_rows(joined))
        })
        .await
    }

    /// Files that exist on disk but are NOT pinned on `indexer_url`, widened to include
    /// thumbnails and old versions. `order` defaults to ASC.
    pub async fn query_local_only_files(
        &self,
        indexer_url: String,
        limit: Option<u32>,
        order: Option<FileQueryOrder>,
        exclude_ids: Option<Vec<String>>,
    ) -> Result<Vec<FileRecord>, DbError> {
        self.query_files(FileQueryOpts {
            limit,
            order: Some(order.unwrap_or(FileQueryOrder::Asc)),
            pinned: Some(FileQueryPinned {
                indexer_url: indexer_url.to_string(),
                is_pinned: false,
            }),
            file_exists_locally: Some(true),
            exclude_ids,
            include_thumbnails: true,
            include_old_versions: true,
            ..Default::default()
        })
        .await
    }

    /// Count of locally-present files; `local_only` flips the pin predicate.
    pub async fn count_local_files(
        &self,
        indexer_url: String,
        local_only: bool,
    ) -> Result<u64, DbError> {
        self.count_files(FileQueryOpts {
            order: Some(FileQueryOrder::Asc),
            pinned: Some(FileQueryPinned {
                indexer_url: indexer_url.to_string(),
                is_pinned: !local_only,
            }),
            file_exists_locally: Some(true),
            include_thumbnails: true,
            include_old_versions: true,
            ..Default::default()
        })
        .await
    }

    /// Count + total bytes of locally-present files; `local_only` flips the pin predicate.
    pub async fn query_local_file_stats(
        &self,
        indexer_url: String,
        local_only: bool,
    ) -> Result<FileStats, DbError> {
        self.query_file_stats(FileQueryOpts {
            order: Some(FileQueryOrder::Asc),
            pinned: Some(FileQueryPinned {
                indexer_url: indexer_url.to_string(),
                is_pinned: !local_only,
            }),
            file_exists_locally: Some(true),
            include_thumbnails: true,
            include_old_versions: true,
            ..Default::default()
        })
        .await
    }

    /// The file row owning the given object on one indexer (`LIMIT 1`). No active-set filter,
    /// matches by object id regardless of trash/delete state.
    pub async fn query_file_by_object_id(
        &self,
        object_id: String,
        indexer_url: String,
    ) -> Result<Option<FileRecordRow>, DbError> {
        self.transaction(move |c| query_file_by_object_id_stmt(c, &object_id, &indexer_url))
            .await
    }

    /// Non-trashed, non-deleted file rows matching the given `localId`s (the device-local
    /// import identifiers).
    pub async fn query_files_by_local_ids(
        &self,
        local_ids: Vec<String>,
    ) -> Result<Vec<FileRecordRow>, DbError> {
        self.transaction(move |c| query_files_by_local_ids_stmt(c, &local_ids))
            .await
    }

    /// Current, non-trashed, non-deleted `kind = 'file'` rows matching any of `names` within
    /// one directory (`None` targets the unfiled root).
    pub async fn query_current_files_by_names_in_directory(
        &self,
        names: Vec<String>,
        directory_id: Option<String>,
    ) -> Result<Vec<FileRecordRow>, DbError> {
        self.transaction(move |c| {
            query_current_files_by_names_in_directory_stmt(c, &names, directory_id.as_deref())
        })
        .await
    }

    /// Non-trashed, non-deleted file rows whose `hash` is in `content_hashes` (any kind, any
    /// version).
    pub async fn query_files_by_content_hashes(
        &self,
        content_hashes: Vec<String>,
    ) -> Result<Vec<FileRecordRow>, DbError> {
        self.transaction(move |c| query_files_by_content_hashes_stmt(c, &content_hashes))
            .await
    }

    /// First non-trashed, non-deleted file row with the given content `hash`, regardless of
    /// kind, so it is NOT safe for thumbnail-parent resolution (several files can share a
    /// hash).
    pub async fn query_file_by_content_hash(
        &self,
        hash: String,
    ) -> Result<Option<FileRecordRow>, DbError> {
        self.transaction(move |c| query_file_by_content_hash_stmt(c, &hash))
            .await
    }

    /// The file row for `id`. No active-set filter, returns the row even if trashed/deleted.
    pub async fn query_file_by_id(&self, id: String) -> Result<Option<FileRecordRow>, DbError> {
        self.transaction(move |c| query_file_by_id_stmt(c, &id))
            .await
    }

    /// Update only the `Some` fields of `update`, then flag the file's objects for sync-up.
    /// Unless `current_recalc` is `Skip`, a change to name/trashedAt/deletedAt/updatedAt
    /// recomputes `current` for the affected groups.
    pub async fn update_file(
        &self,
        update: FileUpdate,
        options: UpdateFileOptions,
    ) -> Result<(), DbError> {
        self.transaction(move |c| update_file_stmt(c, update, options))
            .await
    }

    /// Insert a root file row and upsert one local object in the same transaction.
    pub async fn create_file_with_local_object(
        &self,
        record: FileRecordRow,
        local_object: LocalObject,
    ) -> Result<(), DbError> {
        self.transaction(move |c| {
            insert_file_stmt(c, &record, InsertFileOptions::default())?;
            local_objects::upsert_object_stmt(c, &local_object)?;
            Ok(())
        })
        .await
    }

    /// Apply a file update and upsert one local object in the same transaction.
    pub async fn update_file_with_local_object(
        &self,
        update: FileUpdate,
        local_object: LocalObject,
        options: UpdateFileOptions,
    ) -> Result<(), DbError> {
        self.transaction(move |c| {
            update_file_stmt(c, update, options)?;
            local_objects::upsert_object_stmt(c, &local_object)?;
            Ok(())
        })
        .await
    }

    /// Hard-delete one file row by id. Leaves thumbnails and does NOT recompute `current`; use
    /// `delete_file_and_thumbnails` when either matters.
    pub async fn delete_file_by_id(&self, id: String) -> Result<(), DbError> {
        self.transaction(move |c| {
            c.execute("DELETE FROM files WHERE id = ?", params![id])?;
            Ok(())
        })
        .await
    }

    /// Tombstone the given files in place: set `deletedAt = now`, fill `trashedAt` if unset
    /// (COALESCE preserves an earlier trash time), and bump `updatedAt`. Unless `sync_up` is
    /// `AlreadyRemote`, also flags the files' objects so sync-up deletes them remotely. Skips
    /// rows already tombstoned (`deletedAt IS NULL` guard) and leaves the rows present:
    /// tombstones are permanent markers, never hard-deleted. Does NOT recompute `current` (the
    /// caller pairs it with a recalc).
    pub async fn tombstone_files(
        &self,
        file_ids: Vec<String>,
        now: i64,
        sync_up: TombstoneSyncUp,
    ) -> Result<(), DbError> {
        self.transaction(move |c| tombstone_files_stmt(c, &file_ids, now, sync_up))
            .await
    }

    /// Hard-delete every thumbnail row pointing at `thumb_for_id`. Leaves the original file row
    /// and does not touch `current`.
    pub async fn delete_thumbnails_by_file_id(&self, thumb_for_id: String) -> Result<(), DbError> {
        self.transaction(move |c| {
            c.execute(
                "DELETE FROM files WHERE thumbForId = ?",
                params![thumb_for_id],
            )?;
            Ok(())
        })
        .await
    }

    /// Hard-delete one file plus its thumbnails, then recompute `current` for its group (key
    /// captured BEFORE the deletes so the recalc sees survivors). Recalc runs only when the
    /// deleted row was `kind = 'file'`.
    pub async fn delete_file_and_thumbnails(&self, id: String) -> Result<(), DbError> {
        self.transaction(move |c| {
            // kind = 'file' in SQL: a thumbnail's group needs no recalc (thumbs carry no `current`).
            let group = c
                .query_row(
                    "SELECT name, directoryId FROM files WHERE id = ? AND kind = 'file'",
                    params![id],
                    name_dir_group_from_db_row,
                )
                .optional()?;
            c.execute("DELETE FROM files WHERE thumbForId = ?", params![id])?;
            c.execute("DELETE FROM files WHERE id = ?", params![id])?;
            if let Some(g) = group {
                recalculate_current_for_group_stmt(c, &g.name, g.directory_id.as_deref())?;
            }
            Ok(())
        })
        .await
    }

    /// Hard-delete the given files plus any thumbnails pointing at them, then recompute
    /// `current` for each affected group. Group keys are captured BEFORE the deletes so the
    /// recalc sees the surviving siblings.
    pub async fn delete_files_and_thumbnails(&self, ids: Vec<String>) -> Result<(), DbError> {
        self.transaction(move |c| delete_files_and_thumbnails_stmt(c, &ids))
            .await
    }

    /// Truncate the `files` table.
    pub async fn delete_all_files(&self) -> Result<(), DbError> {
        self.transaction(move |c| {
            c.execute("DELETE FROM files", [])?;
            Ok(())
        })
        .await
    }

    /// Bulk-insert file rows into one `directory_id`. Unless `current_recalc` is `Skip`,
    /// recomputes `current` for every group the `kind = 'file'` rows touch.
    pub async fn insert_many_files(
        &self,
        records: Vec<FileRecordRow>,
        current_recalc: CurrentRecalc,
        directory_id: Option<String>,
        on_conflict: InsertConflict,
    ) -> Result<(), DbError> {
        if records.is_empty() {
            return Ok(());
        }
        self.transaction(move |c| {
            let verb = match on_conflict {
                InsertConflict::Fail => "INSERT",
                InsertConflict::Ignore => "INSERT OR IGNORE",
            };
            let mut stmt = c.prepare(&format!(
                "{verb} INTO files (id, name, nameSortKey, size, createdAt, updatedAt, type, kind,
                   localId, hash, addedAt, thumbForId, thumbSize, trashedAt, deletedAt, lostReason,
                   directoryId)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ))?;
            for r in &records {
                stmt.execute(params![
                    r.id,
                    r.name,
                    natural_sort_key(Some(&r.name)),
                    r.size,
                    r.created_at,
                    r.updated_at,
                    r.type_,
                    file_kind_str(r.kind),
                    r.local_id,
                    r.hash,
                    r.added_at,
                    r.thumb_for_id,
                    r.thumb_size.map(i64::from),
                    r.trashed_at,
                    r.deleted_at,
                    r.lost_reason,
                    directory_id,
                ])?;
            }
            recalc_if_needed(c, &records, current_recalc)
        })
        .await
    }

    /// Bulk-upsert file rows on `id` conflict. The update set deliberately omits
    /// `directoryId`/`localId`/`addedAt`/`deletedAt`/`lostReason`, so a re-sync can't clobber
    /// them. Unless `current_recalc` is `Skip`, recomputes `current` for every group the `kind
    /// = 'file'` rows touch so a new current version demotes the prior one.
    pub async fn upsert_many_files(
        &self,
        records: Vec<FileRecordRow>,
        current_recalc: CurrentRecalc,
    ) -> Result<(), DbError> {
        self.transaction(move |c| upsert_many_files_stmt(c, &records, current_recalc))
            .await
    }

    /// Hard-delete the given files by id (only those rows, NOT their thumbnails), then
    /// recompute `current` for each affected group, keys captured before the delete so the
    /// recalc sees the survivors.
    pub async fn delete_many_files_by_ids(&self, ids: Vec<String>) -> Result<(), DbError> {
        if ids.is_empty() {
            return Ok(());
        }
        self.transaction(move |c| {
            let groups = query_name_dir_groups(c, &ids)?;
            c.execute(
                "DELETE FROM files WHERE id IN rarray(?)",
                [sql::id_array(&ids)],
            )?;
            recalculate_current_for_groups_stmt(c, &groups)?;
            Ok(())
        })
        .await
    }

    /// All live (not trashed, not deleted) `kind = 'file'` rows sharing this `(name,
    /// directoryId)`, newest first. `None` directory targets the unfiled root. Thumbnails
    /// excluded.
    pub async fn query_file_versions(
        &self,
        name: String,
        directory_id: Option<String>,
    ) -> Result<Vec<FileRecordRow>, DbError> {
        self.transaction(move |c| query_file_versions_stmt(c, &name, directory_id.as_deref()))
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> Db {
        Db::open_in_memory().await.unwrap()
    }

    // Insert a file row directly (bypassing insert_file's recalc so a test can pin
    // `current`). Only the columns the query ops read.
    #[allow(clippy::too_many_arguments)]
    async fn put_file(
        db: &Db,
        id: &str,
        name: &str,
        directory_id: Option<&str>,
        kind: &str,
        hash: &str,
        size: i64,
        added_at: i64,
        lost_reason: Option<&str>,
    ) {
        let (id, name, directory_id, kind, hash, lost_reason) = (
            id.to_string(),
            name.to_string(),
            directory_id.map(|s| s.to_string()),
            kind.to_string(),
            hash.to_string(),
            lost_reason.map(|s| s.to_string()),
        );
        db.transaction(move |c| {
            c.execute(
                "INSERT INTO files (id, name, directoryId, kind, hash, size, type, createdAt, updatedAt, addedAt, lostReason, current) \
                  VALUES (?, ?, ?, ?, ?, ?, '', 0, 0, ?, ?, 1)",
                params![id, name, directory_id, kind, hash, size, added_at, lost_reason],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    }

    // The query ops only need the (fileId, indexerURL, id) ref; the rest of the NOT
    // NULL columns get ''/0 placeholders. needsSyncUp defaults to 0.
    async fn put_object(db: &Db, file_id: &str, object_id: &str, indexer_url: &str) {
        let (file_id, object_id, indexer_url) = (
            file_id.to_string(),
            object_id.to_string(),
            indexer_url.to_string(),
        );
        db.transaction(move |c| {
            c.execute(
                "INSERT INTO objects (fileId, indexerURL, id, slabs, encryptedDataKey, encryptedMetadataKey, encryptedMetadata, dataSignature, metadataSignature, createdAt, updatedAt) \
                  VALUES (?, ?, ?, '', '', '', '', '', '', 0, 0)",
                params![file_id, indexer_url, object_id],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    }

    async fn put_fs(db: &Db, file_id: &str) {
        let file_id = file_id.to_string();
        db.transaction(move |c| {
            c.execute(
                "INSERT INTO fs (fileId, size, addedAt, usedAt) VALUES (?, 1, 0, 0)",
                params![file_id],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    }

    async fn current_flag(db: &Db, id: &str) -> i64 {
        let id = id.to_string();
        db.transaction(move |c| {
            Ok(
                c.query_row("SELECT current FROM files WHERE id = ?", params![id], |r| {
                    r.get(0)
                })?,
            )
        })
        .await
        .unwrap()
    }

    // build_file_records_query SQL-shape assertions (no DB).

    #[test]
    fn build_file_records_query_default_is_active_set_only() {
        let (where_sql, params, order_expr, limit_expr) =
            build_file_records_query(&FileQueryOpts::default(), "f");
        assert!(where_sql.starts_with("WHERE "));
        assert!(where_sql.contains("f.kind = 'file'"));
        assert!(where_sql.contains("f.current = 1"));
        assert!(where_sql.contains("f.trashedAt IS NULL"));
        assert!(where_sql.contains("f.deletedAt IS NULL"));
        assert!(params.is_empty());
        assert_eq!(order_expr, "f.createdAt ASC, f.id ASC");
        assert_eq!(limit_expr, "");
    }

    #[test]
    fn build_file_records_query_pinned_and_exclude_emit_params_in_order() {
        let opts = FileQueryOpts {
            order: Some(FileQueryOrder::Desc),
            pinned: Some(FileQueryPinned {
                indexer_url: "idx".into(),
                is_pinned: true,
            }),
            exclude_ids: Some(vec!["x".into(), "y".into()]),
            ..Default::default()
        };
        let (where_sql, params, order_expr, _) = build_file_records_query(&opts, "f");
        assert!(where_sql.contains(
            "EXISTS (SELECT 1 FROM objects s WHERE s.fileId = f.id AND s.indexerURL = ?)"
        ));
        assert!(where_sql.contains("f.id NOT IN (?, ?)"));
        // The pinned param precedes the two exclude params.
        assert_eq!(params.len(), 3);
        assert_eq!(order_expr, "f.createdAt DESC, f.id DESC");
    }

    #[tokio::test]
    async fn query_files_by_object_ids_joins_and_keys_by_object_id() {
        let db = test_db().await;
        put_file(&db, "f1", "a.txt", None, "file", "h1", 10, 1, None).await;
        put_file(&db, "f2", "b.txt", None, "file", "h2", 20, 2, None).await;
        put_object(&db, "f1", "obj1", "https://a.com").await;
        put_object(&db, "f2", "obj2", "https://a.com").await;
        // Same object id on a different indexer must NOT match.
        put_object(&db, "f1", "obj-other", "https://b.com").await;

        let result = db
            .query_files_by_object_ids(
                vec!["obj1".into(), "obj2".into(), "obj-other".into()],
                "https://a.com".to_string(),
            )
            .await
            .unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result.get("obj1").unwrap().id, "f1");
        assert_eq!(result.get("obj2").unwrap().id, "f2");
        assert!(!result.contains_key("obj-other"));
    }

    #[tokio::test]
    async fn query_directory_ids_for_files_distinct_non_null() {
        let db = test_db().await;
        db.transaction(|c| {
            for d in ["d1", "d2"] {
                c.execute(
                    "INSERT INTO directories (id, path, createdAt) VALUES (?, ?, 0)",
                    params![d, format!("/{d}")],
                )?;
            }
            Ok(())
        })
        .await
        .unwrap();
        put_file(&db, "f1", "a", Some("d1"), "file", "h1", 1, 1, None).await;
        put_file(&db, "f2", "b", Some("d1"), "file", "h2", 1, 2, None).await;
        put_file(&db, "f3", "c", Some("d2"), "file", "h3", 1, 3, None).await;
        put_file(&db, "f4", "d", None, "file", "h4", 1, 4, None).await;

        let mut ids = db
            .query_directory_ids_for_files(vec!["f1".into(), "f2".into(), "f3".into(), "f4".into()])
            .await
            .unwrap();
        ids.sort();
        // d1 deduped (f1+f2), d2 once, f4's NULL directory excluded.
        assert_eq!(ids, vec!["d1".to_string(), "d2".to_string()]);
    }

    #[tokio::test]
    async fn query_uploaded_file_ids_distinct_for_indexer() {
        let db = test_db().await;
        put_file(&db, "f1", "a", None, "file", "h1", 1, 1, None).await;
        put_file(&db, "f2", "b", None, "file", "h2", 1, 2, None).await;
        put_file(&db, "f3", "c", None, "file", "h3", 1, 3, None).await;
        // f1 has two objects on the same indexer → still DISTINCT once.
        put_object(&db, "f1", "o1", "https://a.com").await;
        put_object(&db, "f1", "o1b", "https://a.com").await;
        put_object(&db, "f2", "o2", "https://a.com").await;
        // f3 only on another indexer.
        put_object(&db, "f3", "o3", "https://b.com").await;

        let mut ids = db
            .query_uploaded_file_ids("https://a.com".to_string())
            .await
            .unwrap();
        ids.sort();
        assert_eq!(ids, vec!["f1".to_string(), "f2".to_string()]);
    }

    #[tokio::test]
    async fn count_unuploaded_files_excludes_files_with_objects() {
        let db = test_db().await;
        put_file(&db, "f1", "a", None, "file", "h1", 1, 1, None).await;
        put_file(&db, "f2", "b", None, "file", "h2", 1, 2, None).await;
        put_object(&db, "f1", "o1", "https://a.com").await;
        // f2 has no object → counted; f1 has one → excluded.
        assert_eq!(db.count_unuploaded_files().await.unwrap(), 1);
    }

    #[tokio::test]
    async fn query_unuploaded_files_orders_by_added_at_desc() {
        let db = test_db().await;
        put_file(&db, "f1", "older", None, "file", "h1", 1, 10, None).await;
        put_file(&db, "f2", "newer", None, "file", "h2", 1, 30, None).await;
        put_file(&db, "f3", "mid", None, "file", "h3", 1, 20, None).await;
        // f4 is uploaded → excluded.
        put_file(&db, "f4", "up", None, "file", "h4", 1, 40, None).await;
        put_object(&db, "f4", "o4", "https://a.com").await;

        let rows = db.query_unuploaded_files().await.unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["f2", "f3", "f1"]);
    }

    #[tokio::test]
    async fn query_active_file_summaries_returns_active_set() {
        let db = test_db().await;
        put_file(&db, "f1", "a", None, "file", "h1", 7, 1, None).await;
        // Trashed row → excluded by build_record_filter.
        put_file(&db, "f2", "b", None, "file", "h2", 9, 2, None).await;
        db.transaction(|c| {
            c.execute("UPDATE files SET trashedAt = 1 WHERE id = 'f2'", [])?;
            Ok(())
        })
        .await
        .unwrap();

        let rows = db.query_active_file_summaries().await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "f1");
        assert_eq!(rows[0].size, 7);
        assert_eq!(rows[0].kind, "file");
    }

    // The lost predicate: lostReason set OR (no object on indexer + no fs row +
    // non-empty hash). All five branches in one test.
    #[tokio::test]
    async fn count_lost_files_counts_lost_files() {
        let db = test_db().await;
        // f1: lostReason set → lost regardless of objects.
        put_file(
            &db,
            "f1",
            "a",
            None,
            "file",
            "h1",
            1,
            1,
            Some("deleted_remote"),
        )
        .await;
        // f2: no object, no fs, non-empty hash → lost.
        put_file(&db, "f2", "b", None, "file", "h2", 1, 2, None).await;
        // f3: has an object on the indexer → NOT lost.
        put_file(&db, "f3", "c", None, "file", "h3", 1, 3, None).await;
        put_object(&db, "f3", "o3", "https://a.com").await;
        // f4: empty hash, no object, no fs → NOT lost (hash != '' fails).
        put_file(&db, "f4", "d", None, "file", "", 1, 4, None).await;
        // f5: present locally (fs row) → NOT lost.
        put_file(&db, "f5", "e", None, "file", "h5", 1, 5, None).await;
        put_fs(&db, "f5").await;

        assert_eq!(
            db.count_lost_files("https://a.com".to_string())
                .await
                .unwrap(),
            2
        );
    }

    #[tokio::test]
    async fn query_lost_file_stats_sums_lost_bytes() {
        let db = test_db().await;
        put_file(
            &db,
            "f1",
            "a",
            None,
            "file",
            "h1",
            100,
            1,
            Some("deleted_remote"),
        )
        .await;
        put_file(&db, "f2", "b", None, "file", "h2", 250, 2, None).await;
        // Not lost (has an object).
        put_file(&db, "f3", "c", None, "file", "h3", 999, 3, None).await;
        put_object(&db, "f3", "o3", "https://a.com").await;

        let stats = db
            .query_lost_file_stats("https://a.com".to_string())
            .await
            .unwrap();
        assert_eq!(stats.count, 2);
        assert_eq!(stats.total_bytes, 350);
    }

    // The aggregate emits `ORDER BY {order_expr}` (inert on one row); this run errors
    // if that clause referenced a missing column, and confirms it counts the active set.
    #[tokio::test]
    async fn count_files_returns_active_count() {
        let db = test_db().await;
        put_file(&db, "f1", "a", None, "file", "h1", 1, 1, None).await;
        put_file(&db, "f2", "b", None, "file", "h2", 1, 2, None).await;
        assert_eq!(db.count_files(FileQueryOpts::default()).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn query_file_stats_sums_active_bytes() {
        let db = test_db().await;
        put_file(&db, "f1", "a", None, "file", "h1", 30, 1, None).await;
        put_file(&db, "f2", "b", None, "file", "h2", 12, 2, None).await;
        let stats = db.query_file_stats(FileQueryOpts::default()).await.unwrap();
        assert_eq!(stats.count, 2);
        assert_eq!(stats.total_bytes, 42);
    }

    // A name update writes `name`, the recomputed `nameSortKey`, and (default
    // options) bumps `updatedAt`.
    #[tokio::test]
    async fn update_file_name_writes_name_sort_key_and_bumps_updated_at() {
        let db = test_db().await;
        // Seed updatedAt = 0 directly so the bump is observable as > 0.
        db.transaction(|c| {
            c.execute(
                "INSERT INTO files (id, name, nameSortKey, kind, hash, size, type, createdAt, updatedAt, addedAt, current) VALUES (?, ?, ?, 'file', 'h', 1, '', 0, 0, 0, 1)",
                params!["f1", "File 2.txt", natural_sort_key(Some("File 2.txt")).unwrap()],
            )?;
            Ok(())
        })
        .await
        .unwrap();

        db.update_file(
            FileUpdate {
                id: "f1".into(),
                name: Some("File 10.txt".into()),
                ..Default::default()
            },
            UpdateFileOptions::default(),
        )
        .await
        .unwrap();

        let (name, sort_key, updated_at): (String, Option<String>, i64) = db
            .transaction(|c| {
                Ok(c.query_row(
                    "SELECT name, nameSortKey, updatedAt FROM files WHERE id = 'f1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )?)
            })
            .await
            .unwrap();
        assert_eq!(name, "File 10.txt");
        // nameSortKey recomputed from the new name (zero-padded digit run, so "10"
        // sorts after "2").
        assert_eq!(sort_key, natural_sort_key(Some("File 10.txt")));
        assert!(updated_at > 0);
    }

    // include_updated_at = true uses the caller-supplied updatedAt verbatim (no now()
    // bump) while still writing nameSortKey.
    #[tokio::test]
    async fn update_file_include_updated_at_uses_supplied_value() {
        let db = test_db().await;
        put_file(&db, "f1", "a.txt", None, "file", "h", 1, 0, None).await;

        db.update_file(
            FileUpdate {
                id: "f1".into(),
                name: Some("b.txt".into()),
                updated_at: Some(12345),
                ..Default::default()
            },
            UpdateFileOptions {
                include_updated_at: true,
                current_recalc: CurrentRecalc::Run,
            },
        )
        .await
        .unwrap();

        let (name, sort_key, updated_at): (String, Option<String>, i64) = db
            .transaction(|c| {
                Ok(c.query_row(
                    "SELECT name, nameSortKey, updatedAt FROM files WHERE id = 'f1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )?)
            })
            .await
            .unwrap();
        assert_eq!(name, "b.txt");
        assert_eq!(sort_key, natural_sort_key(Some("b.txt")));
        assert_eq!(updated_at, 12345);
    }

    // insert_file recalcs `current`: a second version of the same name in the same
    // directory becomes current and demotes the first.
    #[tokio::test]
    async fn insert_file_recalculates_current_to_newest_version() {
        let db = test_db().await;
        db.insert_file(
            FileRecordRow::test("v1").name("a.txt").updated_at(100),
            InsertFileOptions::default(),
        )
        .await
        .unwrap();
        db.insert_file(
            FileRecordRow::test("v2").name("a.txt").updated_at(200),
            InsertFileOptions::default(),
        )
        .await
        .unwrap();
        assert_eq!(current_flag(&db, "v1").await, 0);
        assert_eq!(current_flag(&db, "v2").await, 1);
    }

    // tombstone_files sets deletedAt, COALESCEs trashedAt (filling it when unset,
    // preserving an earlier value), and flags the file's objects under Flag.
    #[tokio::test]
    async fn tombstone_files_tombstones_and_flags_objects() {
        let db = test_db().await;
        put_file(&db, "f1", "a", None, "file", "h1", 1, 1, None).await;
        // f2 was trashed earlier (trashedAt = 50); COALESCE must keep that, not now.
        put_file(&db, "f2", "b", None, "file", "h2", 1, 2, None).await;
        db.transaction(|c| {
            c.execute("UPDATE files SET trashedAt = 50 WHERE id = 'f2'", [])?;
            Ok(())
        })
        .await
        .unwrap();
        put_object(&db, "f1", "o1", "https://a.com").await;

        db.tombstone_files(vec!["f1".into(), "f2".into()], 999, TombstoneSyncUp::Flag)
            .await
            .unwrap();

        async fn row(db: &Db, id: &str) -> (Option<i64>, Option<i64>, i64) {
            let id = id.to_string();
            db.transaction(move |c| {
                Ok(c.query_row(
                    "SELECT deletedAt, trashedAt, updatedAt FROM files WHERE id = ?",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )?)
            })
            .await
            .unwrap()
        }
        assert_eq!(row(&db, "f1").await, (Some(999), Some(999), 999));
        // f2's earlier trashedAt survives COALESCE.
        assert_eq!(row(&db, "f2").await, (Some(999), Some(50), 999));

        let needs_sync_up: bool = db
            .transaction(|c| {
                Ok(c.query_row(
                    "SELECT needsSyncUp FROM objects WHERE id = 'o1' AND indexerURL = 'https://a.com'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .await
            .unwrap();
        assert!(needs_sync_up);
    }

    // The upsert update set excludes localId/addedAt/deletedAt/lostReason, so a
    // conflicting re-sync updates name/hash but must not clobber those.
    #[tokio::test]
    async fn upsert_many_files_preserves_unlisted_columns() {
        let db = test_db().await;
        db.transaction(|c| {
            c.execute(
                "INSERT INTO files (id, localId, name, size, type, kind, createdAt, updatedAt, hash, addedAt, deletedAt, current) \
                  VALUES ('f1', 'L1', 'old', 1, '', 'file', 0, 0, 'h_old', 7, 42, 1)",
                [],
            )?;
            Ok(())
        })
        .await
        .unwrap();

        let incoming = FileRecordRow::test("f1")
            .name("new")
            .hash("h_new")
            .local_id("L2")
            .deleted_at(99)
            .added_at(123);
        db.upsert_many_files(vec![incoming], CurrentRecalc::Run)
            .await
            .unwrap();

        let (name, hash, local_id, added_at, deleted_at): (
            String,
            String,
            Option<String>,
            i64,
            Option<i64>,
        ) = db
            .transaction(|c| {
                Ok(c.query_row(
                    "SELECT name, hash, localId, addedAt, deletedAt FROM files WHERE id = 'f1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )?)
            })
            .await
            .unwrap();
        // Listed columns updated.
        assert_eq!(name, "new");
        assert_eq!(hash, "h_new");
        // Unlisted columns preserved from the original row.
        assert_eq!(local_id, Some("L1".to_string()));
        assert_eq!(added_at, 7);
        assert_eq!(deleted_at, Some(42));
    }

    // One representative empty-input guard: the batch ops short-circuit before
    // building an `IN ()` list.
    #[tokio::test]
    async fn move_files_all_versions_empty_is_noop() {
        let db = test_db().await;
        assert!(
            db.move_files_all_versions(vec![], None)
                .await
                .unwrap()
                .is_empty()
        );
    }

    // Two same-name stacks in different directories, each multi-version, moved into
    // one shared directory. The globally-newest version across the merged group wins
    // `current` and every other version is demoted. Exercises the bulk recalc's
    // null-safe `IS` join (the unfiled stack merges in) and globally-newest-as-current
    // ranking.
    #[tokio::test]
    async fn move_files_all_versions_merges_groups_to_globally_newest_current() {
        let db = test_db().await;
        db.transaction(|c| {
            for d in ["d1", "dest"] {
                c.execute(
                    "INSERT INTO directories (id, path, createdAt) VALUES (?, ?, 0)",
                    params![d, format!("/{d}")],
                )?;
            }
            Ok(())
        })
        .await
        .unwrap();
        // Stack A: "report.txt" in d1, two versions.
        put_file(&db, "a1", "report.txt", Some("d1"), "file", "h", 1, 1, None).await;
        put_file(&db, "a2", "report.txt", Some("d1"), "file", "h", 1, 2, None).await;
        // Stack B: "report.txt" unfiled (directoryId NULL), two versions.
        put_file(&db, "b1", "report.txt", None, "file", "h", 1, 3, None).await;
        put_file(&db, "b2", "report.txt", None, "file", "h", 1, 4, None).await;
        // b2 has the globally-newest updatedAt across both stacks.
        db.transaction(|c| {
            for (id, updated) in [("a1", 100), ("a2", 250), ("b1", 200), ("b2", 400)] {
                c.execute(
                    "UPDATE files SET updatedAt = ? WHERE id = ?",
                    params![updated, id],
                )?;
            }
            Ok(())
        })
        .await
        .unwrap();

        // One id per stack drives the move; every version of each stack moves with it.
        db.move_files_all_versions(vec!["a1".into(), "b1".into()], Some("dest".to_string()))
            .await
            .unwrap();

        assert_eq!(current_flag(&db, "b2").await, 1);
        for id in ["a1", "a2", "b1"] {
            assert_eq!(current_flag(&db, id).await, 0, "{id} should be demoted");
        }
    }

    // A file with objects on two indexers comes back as ONE grouped record carrying
    // both refs, not two JOIN rows. Guards the IndexMap grouping in `group_joined_file_rows`.
    #[tokio::test]
    async fn query_files_groups_multiple_objects_into_one_record() {
        let db = test_db().await;
        put_file(&db, "f1", "a.txt", None, "file", "h1", 10, 1, None).await;
        put_object(&db, "f1", "obj-a", "https://a.com").await;
        put_object(&db, "f1", "obj-b", "https://b.com").await;

        let records = db.query_files(FileQueryOpts::default()).await.unwrap();

        assert_eq!(records.len(), 1);
        let rec = &records[0];
        assert_eq!(rec.row.id, "f1");
        assert_eq!(rec.objects.len(), 2);
        assert_eq!(rec.objects.get("https://a.com").unwrap().id, "obj-a");
        assert_eq!(rec.objects.get("https://b.com").unwrap().id, "obj-b");
    }

    // LIMIT counts files, not JOIN rows: with a two-object file first, LIMIT 2 must
    // return two complete files, not one file assembled from two JOIN rows.
    #[tokio::test]
    async fn query_files_limit_counts_files_and_never_splits_objects() {
        let db = test_db().await;
        put_file(&db, "f1", "a.txt", None, "file", "h1", 10, 1, None).await;
        put_file(&db, "f2", "b.txt", None, "file", "h2", 20, 2, None).await;
        put_object(&db, "f1", "obj-a", "https://a.com").await;
        put_object(&db, "f1", "obj-b", "https://b.com").await;
        put_object(&db, "f2", "obj-c", "https://a.com").await;

        let records = db
            .query_files(FileQueryOpts {
                limit: Some(2),
                ..Default::default()
            })
            .await
            .unwrap();

        assert_eq!(records.len(), 2, "limit is a file count");
        assert_eq!(records[0].row.id, "f1");
        assert_eq!(
            records[0].objects.len(),
            2,
            "no split objects map at the cut"
        );
        assert_eq!(records[1].row.id, "f2");
        assert_eq!(records[1].objects.len(), 1);
    }
}
