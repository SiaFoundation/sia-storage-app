use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value};

use crate::db::DbError;
use crate::db::database::Db;
use crate::db::operations::files::{
    CurrentRecalc, NameDirGroup, file_record_row_from_db_row, query_name_dir_groups,
    recalculate_current_for_file_ids_stmt, recalculate_current_for_group_stmt,
};
use crate::db::operations::filter::{BuildRecordFilterOpts, build_record_filter};
use crate::db::operations::{local_objects, trash};
use crate::db::sql;
use crate::lib_utils::natural_sort_key::natural_sort_key;
use crate::lib_utils::unique_id::unique_id;
use crate::types::files::FileRecordRow;

fn directory_from_db_row(r: &rusqlite::Row) -> rusqlite::Result<Directory> {
    let path: String = r.get("path")?;
    Ok(Directory {
        id: r.get("id")?,
        name: directory_display_name(&path),
        path,
        created_at: r.get("createdAt")?,
    })
}

/// Decodes a directory row carrying the `fileCount`/`subdirectoryCount` aggregates
/// emitted by both directory-listing queries.
fn directory_with_count_from_db_row(r: &rusqlite::Row) -> rusqlite::Result<DirectoryWithCount> {
    Ok(DirectoryWithCount {
        directory: directory_from_db_row(r)?,
        file_count: r.get("fileCount")?,
        subdirectory_count: r.get("subdirectoryCount")?,
    })
}

#[derive(Debug, thiserror::Error)]
pub enum DirectoryError {
    #[error("Folder name cannot be empty")]
    EmptyName,
    #[error("Folder \"{0}\" already exists")]
    AlreadyExists(String),
    #[error("Folder \"{0}\" already exists at destination")]
    AlreadyExistsAtDest(String),
    #[error("Failed to get or create directory \"{0}\"")]
    GetOrCreateFailed(String),
    #[error("Invalid directory path: \"{0}\"")]
    InvalidPath(String),
    #[error("Directory not found")]
    NotFound,
    #[error("Cannot move a folder into itself or a subfolder of itself")]
    MoveIntoSelf,
    #[error(transparent)]
    Db(#[from] DbError),
}

impl From<rusqlite::Error> for DirectoryError {
    fn from(e: rusqlite::Error) -> Self {
        DirectoryError::Db(DbError::from(e))
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Directory {
    pub id: String,
    pub path: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryWithCount {
    // Flattened so the serialized shape is a single object:
    // `{id, path, name, createdAt, fileCount, subdirectoryCount}`.
    #[serde(flatten)]
    pub directory: Directory,
    pub file_count: u64,
    pub subdirectory_count: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySyncEntry {
    pub file_id: String,
    pub directory_path: String,
}

/// Returns the last segment of a path (everything after the last `/`, or the
/// whole path when there is none).
pub fn directory_display_name(path: &str) -> String {
    match path.rfind('/') {
        Some(i) => path[i + 1..].to_string(),
        None => path.to_string(),
    }
}

/// Returns the parent path (everything before the last `/`), or `None` for a
/// root-level path with no separator.
pub fn directory_parent_path(path: &str) -> Option<String> {
    path.rfind('/').map(|i| path[..i].to_string())
}

// Subtree matching compares a BINARY substr prefix rather than `LIKE ? || '/%'`: SQLite LIKE is
// case-insensitive for ASCII, so a `Photos/%` pattern would also match a case-variant sibling
// like `photos/...`. Paths are case-sensitive here. substr also needs no metachar escaping.

/// `col` starts with the bound `"<path>/"` prefix; bind the prefix twice. Plain `?`s
/// (not `?N`) so the fragment composes positionally into any host statement.
fn starts_with_param(col: &str) -> String {
    format!("substr({col}, 1, length(?)) = ?")
}

/// Correlated form: `col` is inside `parent`'s subtree (starts with `parent || '/'`).
fn starts_with_col(col: &str, parent: &str) -> String {
    format!("substr({col}, 1, length({parent}) + 1) = {parent} || '/'")
}

/// Normalizes one path segment: strips slashes and control chars, trims
/// surrounding whitespace, rejects runs of dots (`.`/`..`) to empty, and
/// truncates to 255 UTF-16 code units.
pub fn sanitize_directory_segment(segment: &str) -> String {
    let mut result = String::new();
    for ch in segment.chars() {
        let code = ch as u32;
        if ch == '/' || ch == '\\' {
            continue;
        }
        if code < 0x20 || code == 0x7f {
            continue;
        }
        result.push(ch);
    }
    let trimmed = result.trim();
    if !trimmed.is_empty() && trimmed.chars().all(|c| c == '.') {
        return String::new();
    }
    // Truncate by UTF-16 code units, not Unicode scalars: an astral char is two
    // code units. Counting scalars instead would keep more code units at the
    // boundary, so two clients would store different truncations of the same name
    // and diverge cross-device. A char whose surrogate pair straddles the cap is
    // kept whole or dropped whole (a lone surrogate can't exist in a Rust String).
    let mut units = 0usize;
    let mut out = String::new();
    for c in trimmed.chars() {
        let next = units + c.len_utf16();
        if next > 255 {
            break;
        }
        units = next;
        out.push(c);
    }
    out
}

/// The directory at `path`, or `None`.
fn query_directory_id_by_path(conn: &Connection, path: &str) -> Result<Option<String>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id FROM directories WHERE path = ? LIMIT 1",
            params![path],
            |r| r.get(0),
        )
        .optional()?)
}

/// The id of another directory at `path` (excluding `exclude_id`), used for
/// destination collision checks on rename/move.
fn query_directory_id_at_path_excluding(
    conn: &Connection,
    path: &str,
    exclude_id: &str,
) -> Result<Option<String>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id FROM directories WHERE path = ? AND id != ?",
            params![path, exclude_id],
            |r| r.get(0),
        )
        .optional()?)
}

/// A file's `(name, directoryId)`, or `None` when the file row is absent.
fn query_file_name_and_directory(
    conn: &Connection,
    file_id: &str,
) -> Result<Option<(String, Option<String>)>, DbError> {
    Ok(conn
        .query_row(
            "SELECT name, directoryId FROM files WHERE id = ?",
            params![file_id],
            |r| Ok((r.get("name")?, r.get("directoryId")?)),
        )
        .optional()?)
}

pub(in crate::db) fn query_directory_by_id_stmt(
    conn: &Connection,
    id: &str,
) -> Result<Option<Directory>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, path, createdAt FROM directories WHERE id = ?",
            params![id],
            directory_from_db_row,
        )
        .optional()?)
}

pub(in crate::db) fn query_directory_by_path_stmt(
    conn: &Connection,
    path: &str,
) -> Result<Option<Directory>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, path, createdAt FROM directories WHERE path = ? LIMIT 1",
            params![path],
            directory_from_db_row,
        )
        .optional()?)
}

pub(in crate::db) fn get_or_create_directory_stmt(
    conn: &Connection,
    name: &str,
    parent_path: Option<&str>,
) -> Result<Directory, DirectoryError> {
    let trimmed = sanitize_directory_segment(name);
    if trimmed.is_empty() {
        return Err(DirectoryError::EmptyName);
    }
    let full_path = match parent_path {
        Some(p) => format!("{}/{}", p, trimmed),
        None => trimmed.clone(),
    };
    let now = Utc::now().timestamp_millis();
    conn.execute(
        "INSERT OR IGNORE INTO directories (id, path, createdAt, nameSortKey) VALUES (?, ?, ?, ?)",
        params![
            unique_id(),
            full_path,
            now,
            natural_sort_key(Some(&full_path)),
        ],
    )?;
    // INSERT OR IGNORE may have rejected our row because another writer inserted
    // the same path first, so last_insert_rowid is unreliable. Re-SELECT by path
    // to get the actual id (ours if we won the insert, theirs if we lost).
    query_directory_by_path_stmt(conn, &full_path)?
        .ok_or_else(|| DirectoryError::GetOrCreateFailed(trimmed))
}

pub(in crate::db) fn get_or_create_directory_at_path_stmt(
    conn: &Connection,
    dir_path: &str,
) -> Result<Directory, DirectoryError> {
    let mut current_path = String::new();
    let mut dir: Option<Directory> = None;
    for segment in dir_path.split('/') {
        let trimmed = sanitize_directory_segment(segment);
        if trimmed.is_empty() {
            continue;
        }
        let parent = if current_path.is_empty() {
            None
        } else {
            Some(current_path.as_str())
        };
        let d = get_or_create_directory_stmt(conn, &trimmed, parent)?;
        current_path = d.path.clone();
        dir = Some(d);
    }
    dir.ok_or_else(|| DirectoryError::InvalidPath(dir_path.to_string()))
}

// Both count sub-expressions are constant SQL with no bound params; they correlate on `d.path`.
fn recursive_file_count_expr() -> String {
    let active = build_record_filter("f", BuildRecordFilterOpts::default());
    format!(
        "(SELECT COUNT(*) FROM files f JOIN directories fd ON f.directoryId = fd.id WHERE (fd.id = d.id OR {}) AND {})",
        starts_with_col("fd.path", "d.path"),
        active
    )
}

fn direct_subdir_count_expr() -> String {
    // Direct children only: inside d's subtree with no further `/` past the prefix.
    format!(
        "(SELECT COUNT(*) FROM directories c WHERE {} AND instr(substr(c.path, length(d.path) + 2), '/') = 0)",
        starts_with_col("c.path", "d.path")
    )
}

/// `path -> id` for every directory whose path is in `paths`.
fn query_directory_ids_by_paths(
    conn: &Connection,
    paths: &[String],
) -> Result<std::collections::HashMap<String, String>, DbError> {
    if paths.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let mut stmt = conn.prepare("SELECT id, path FROM directories WHERE path IN rarray(?)")?;
    let rows = stmt
        .query_map([sql::id_array(paths)], |r| {
            Ok((r.get::<_, String>("path")?, r.get::<_, String>("id")?))
        })?
        .collect::<rusqlite::Result<Vec<(String, String)>>>()?;
    Ok(rows.into_iter().collect())
}

/// Ensures every input path (and all of its prefixes) exists as a directory row
/// in one batched pass, returning a map from each original input string to the
/// id of its normalized directory.
fn get_or_create_directories_at_paths(
    conn: &Connection,
    full_paths: impl IntoIterator<Item = String>,
) -> Result<std::collections::HashMap<String, String>, DbError> {
    // Expand each input path into its sanitized normal form and all of its
    // prefixes, so a/b/c also creates a and a/b. Map the original input string to
    // the normalized path so callers can look up by what they passed in.
    let mut input_to_normalized: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut prefixes: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for raw in full_paths {
        let segments: Vec<String> = raw
            .split('/')
            .map(sanitize_directory_segment)
            .filter(|s| !s.is_empty())
            .collect();
        if segments.is_empty() {
            input_to_normalized.insert(raw, String::new());
            continue;
        }
        let mut cur = String::new();
        for seg in &segments {
            cur = if cur.is_empty() {
                seg.clone()
            } else {
                format!("{}/{}", cur, seg)
            };
            prefixes.insert(cur.clone());
        }
        input_to_normalized.insert(raw, cur);
    }
    if prefixes.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let arr: Vec<String> = prefixes.into_iter().collect();
    let mut path_to_id = query_directory_ids_by_paths(conn, &arr)?;
    let missing: Vec<String> = arr
        .iter()
        .filter(|p| !path_to_id.contains_key(*p))
        .cloned()
        .collect();
    if !missing.is_empty() {
        let now = Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "INSERT OR IGNORE INTO directories (id, path, createdAt, nameSortKey) VALUES (?, ?, ?, ?)",
        )?;
        for path in &missing {
            stmt.execute(params![
                unique_id(),
                path,
                now,
                natural_sort_key(Some(path))
            ])?;
        }
        // OR IGNORE may have rejected rows that another writer inserted first.
        // Re-SELECT to get the actual id for every missing path.
        for (path, id) in query_directory_ids_by_paths(conn, &missing)? {
            path_to_id.insert(path, id);
        }
    }

    let mut result: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for (input, normalized) in input_to_normalized {
        if normalized.is_empty() {
            continue;
        }
        if let Some(id) = path_to_id.get(&normalized) {
            result.insert(input, id.clone());
        }
    }
    Ok(result)
}

fn query_subtree_directory_ids(conn: &Connection, path: &str) -> Result<Vec<String>, DbError> {
    let prefix = format!("{}/", path);
    let mut stmt = conn.prepare(&format!(
        "SELECT id FROM directories WHERE path = ? OR {}",
        starts_with_param("path")
    ))?;
    let out = stmt
        .query_map(params![path, prefix, prefix], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(out)
}

fn rebase_directory_tree(
    conn: &Connection,
    dir_id: &str,
    old_path: &str,
    new_path: &str,
) -> Result<(), DbError> {
    conn.execute(
        "UPDATE directories SET path = ?, nameSortKey = ? WHERE id = ?",
        params![new_path, natural_sort_key(Some(new_path)), dir_id],
    )?;
    let old_prefix = format!("{}/", old_path);
    let new_prefix = format!("{}/", new_path);
    let descendants: Vec<(String, String)> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT id, path FROM directories WHERE {}",
            starts_with_param("path")
        ))?;
        stmt.query_map(params![old_prefix, old_prefix], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?
        .collect::<rusqlite::Result<Vec<(String, String)>>>()?
    };
    let mut stmt = conn.prepare("UPDATE directories SET path = ?, nameSortKey = ? WHERE id = ?")?;
    for (id, path) in &descendants {
        let rebased = format!("{}{}", new_prefix, &path[old_prefix.len()..]);
        stmt.execute(params![rebased, natural_sort_key(Some(&rebased)), id])?;
    }
    // Bump updatedAt for every file in the renamed/moved subtree and flag its
    // objects so sync-up re-pushes the new directory. Without this a folder rename
    // or move never reaches other devices.
    conn.execute(
        &format!(
            r"UPDATE files SET updatedAt = ? WHERE directoryId IN (
                SELECT id FROM directories WHERE path = ? OR {}
              )",
            starts_with_param("path")
        ),
        params![
            Utc::now().timestamp_millis(),
            new_path,
            new_prefix,
            new_prefix
        ],
    )?;
    let subtree_file_ids: Vec<String> = {
        let mut stmt = conn.prepare(&format!(
            r"SELECT id FROM files WHERE directoryId IN (
                SELECT id FROM directories WHERE path = ? OR {}
              )",
            starts_with_param("path")
        ))?;
        stmt.query_map(params![new_path, new_prefix, new_prefix], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?
    };
    local_objects::flag_objects_for_files_stmt(conn, &subtree_file_ids)?;
    Ok(())
}

pub(in crate::db) fn query_directory_path_for_file_stmt(
    conn: &Connection,
    file_id: &str,
) -> Result<Option<String>, DbError> {
    Ok(conn
        .query_row(
            r"SELECT d.path FROM directories d
              INNER JOIN files f ON f.directoryId = d.id
              WHERE f.id = ?",
            params![file_id],
            |r| r.get(0),
        )
        .optional()?)
}

pub(in crate::db) fn sync_directories_from_metadata_stmt(
    conn: &Connection,
    entries: &[DirectorySyncEntry],
) -> Result<Vec<NameDirGroup>, DirectoryError> {
    let dir_paths: std::collections::BTreeSet<String> =
        entries.iter().map(|e| e.directory_path.clone()).collect();
    let path_to_id = get_or_create_directories_at_paths(conn, dir_paths)?;

    let file_ids: Vec<String> = entries.iter().map(|e| e.file_id.clone()).collect();
    let old_groups = query_name_dir_groups(conn, &file_ids)?;

    // Group the file ids by their resolved directory id and update each group in
    // one statement. Entries whose path sanitizes to empty have no `path_to_id`
    // entry, so they're skipped and left unfiled: no directory created, no error.
    let mut by_dir_id: indexmap::IndexMap<String, Vec<String>> = indexmap::IndexMap::new();
    for entry in entries {
        let Some(dir_id) = path_to_id.get(&entry.directory_path) else {
            continue;
        };
        by_dir_id
            .entry(dir_id.clone())
            .or_default()
            .push(entry.file_id.clone());
    }
    let mut stmt = conn.prepare("UPDATE files SET directoryId = ? WHERE id IN rarray(?)")?;
    for (dir_id, ids) in &by_dir_id {
        stmt.execute(params![dir_id, sql::id_array(ids)])?;
    }
    Ok(old_groups)
}

pub(in crate::db) fn delete_empty_directories_stmt(
    conn: &Connection,
    directory_ids: &[String],
) -> Result<u64, DbError> {
    let mut candidates: Vec<String> = directory_ids
        .iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut total_deleted = 0u64;
    let active = build_record_filter("f", BuildRecordFilterOpts::default());
    while !candidates.is_empty() {
        let empties: Vec<(String, String)> = {
            let q = format!(
                r"SELECT d.id, d.path FROM directories d
                  WHERE d.id IN rarray(?)
                    AND NOT EXISTS (
                      SELECT 1 FROM files f
                      WHERE f.directoryId = d.id AND {}
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM directories c
                      WHERE {}
                    )",
                active,
                starts_with_col("c.path", "d.path")
            );
            let mut stmt = conn.prepare(&q)?;
            stmt.query_map([sql::id_array(&candidates)], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<rusqlite::Result<Vec<(String, String)>>>()?
        };
        if empties.is_empty() {
            break;
        }
        let ids: Vec<String> = empties.iter().map(|(id, _)| id.clone()).collect();
        conn.execute(
            "DELETE FROM directories WHERE id IN rarray(?)",
            [sql::id_array(&ids)],
        )?;
        total_deleted += ids.len() as u64;
        let parent_paths: std::collections::BTreeSet<String> = empties
            .iter()
            .filter_map(|(_, path)| directory_parent_path(path))
            .collect();
        if parent_paths.is_empty() {
            break;
        }
        let parents: Vec<String> = parent_paths.into_iter().collect();
        candidates = query_directory_ids_by_paths(conn, &parents)?
            .into_values()
            .collect();
    }
    Ok(total_deleted)
}

impl Db {
    pub async fn insert_directory(
        &self,
        name: String,
        parent_path: Option<String>,
    ) -> Result<Directory, DirectoryError> {
        let trimmed = sanitize_directory_segment(&name);
        if trimmed.is_empty() {
            return Err(DirectoryError::EmptyName);
        }
        let full_path = match parent_path {
            Some(p) => format!("{}/{}", p, trimmed),
            None => trimmed.clone(),
        };
        self.transaction(move |c| {
            if query_directory_id_by_path(c, &full_path)?.is_some() {
                return Ok(Err(DirectoryError::AlreadyExists(full_path)));
            }
            let now = Utc::now().timestamp_millis();
            let dir = Directory {
                id: unique_id(),
                path: full_path.clone(),
                name: directory_display_name(&full_path),
                created_at: now,
            };
            c.execute(
                "INSERT INTO directories (id, path, createdAt, nameSortKey) VALUES (?, ?, ?, ?)",
                params![
                    dir.id,
                    dir.path,
                    dir.created_at,
                    natural_sort_key(Some(&full_path)),
                ],
            )?;
            Ok(Ok(dir))
        })
        .await?
    }

    pub async fn get_or_create_directory(
        &self,
        name: String,
        parent_path: Option<String>,
    ) -> Result<Directory, DirectoryError> {
        self.transaction(move |c| {
            Ok(get_or_create_directory_stmt(
                c,
                &name,
                parent_path.as_deref(),
            ))
        })
        .await?
    }

    pub async fn get_or_create_directory_at_path(
        &self,
        dir_path: String,
    ) -> Result<Directory, DirectoryError> {
        self.transaction(move |c| Ok(get_or_create_directory_at_path_stmt(c, &dir_path)))
            .await?
    }

    pub async fn query_directory_by_id(&self, id: String) -> Result<Option<Directory>, DbError> {
        self.transaction(move |c| query_directory_by_id_stmt(c, &id))
            .await
    }

    /// Matches `path` exactly, not by prefix.
    pub async fn query_directory_by_path(
        &self,
        path: String,
    ) -> Result<Option<Directory>, DbError> {
        self.transaction(move |c| query_directory_by_path_stmt(c, &path))
            .await
    }

    /// Lists the immediate child directories of `parent_path` (top-level when
    /// `None`), each with its recursive file count and direct-subdirectory count,
    /// ordered by natural-sort name.
    pub async fn query_directory_children(
        &self,
        parent_path: Option<String>,
    ) -> Result<Vec<DirectoryWithCount>, DbError> {
        self.transaction(move |c| {
            let (q, params): (String, Vec<Value>) = match parent_path.as_deref() {
                None => (
                    format!(
                        r"SELECT d.id, d.path, d.createdAt,
                           {} as fileCount,
                           {} as subdirectoryCount
                          FROM directories d
                          WHERE instr(d.path, '/') = 0
                          ORDER BY d.nameSortKey",
                        recursive_file_count_expr(),
                        direct_subdir_count_expr()
                    ),
                    Vec::new(),
                ),
                Some(p) => {
                    let prefix = format!("{}/", p);
                    (
                        format!(
                            r"SELECT d.id, d.path, d.createdAt,
                               {} as fileCount,
                               {} as subdirectoryCount
                              FROM directories d
                              WHERE {} AND instr(substr(d.path, length(?) + 1), '/') = 0
                              ORDER BY d.nameSortKey",
                            recursive_file_count_expr(),
                            direct_subdir_count_expr(),
                            starts_with_param("d.path")
                        ),
                        vec![
                            Value::Text(prefix.clone()),
                            Value::Text(prefix.clone()),
                            Value::Text(prefix),
                        ],
                    )
                }
            };
            let mut stmt = c.prepare(&q)?;
            let out = stmt
                .query_map(
                    params_from_iter(params.iter()),
                    directory_with_count_from_db_row,
                )?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(out)
        })
        .await
    }

    /// Lists every directory with its recursive file count and direct-subdirectory
    /// count, ordered by natural-sort name.
    pub async fn query_all_directories_with_counts(
        &self,
    ) -> Result<Vec<DirectoryWithCount>, DbError> {
        self.transaction(move |c| {
            let q = format!(
                r"SELECT d.id, d.path, d.createdAt,
                   {} as fileCount,
                   {} as subdirectoryCount
                  FROM directories d
                  ORDER BY d.nameSortKey",
                recursive_file_count_expr(),
                direct_subdir_count_expr()
            );
            let mut stmt = c.prepare(&q)?;
            let out = stmt
                .query_map([], directory_with_count_from_db_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(out)
        })
        .await
    }

    /// Returns the path of the directory a file lives in, or `None` if the file is
    /// at root (no directory).
    pub async fn query_directory_path_for_file(
        &self,
        file_id: String,
    ) -> Result<Option<String>, DbError> {
        self.transaction(move |c| query_directory_path_for_file_stmt(c, &file_id))
            .await
    }

    /// Returns the full `Directory` (id + path) a file lives in, or `None` when the file is unfiled.
    /// The File-Provider `item(for:)` uses it to report a filed file's real parent (`dir:<id>:<path>`)
    /// instead of `.rootContainer`, matching what the directory enumerator reports. Without this,
    /// fileproviderd's per-item parent-consistency check would drop every file in a directory.
    pub async fn query_directory_for_file(
        &self,
        file_id: String,
    ) -> Result<Option<Directory>, DbError> {
        self.transaction(move |c| {
            Ok(c.query_row(
                "SELECT d.id, d.path, d.createdAt FROM directories d
                  INNER JOIN files f ON f.directoryId = d.id WHERE f.id = ?",
                params![file_id],
                directory_from_db_row,
            )
            .optional()?)
        })
        .await
    }

    /// Reassigns a single file into the directory at `directory_path` (creating the
    /// path and its prefixes if needed), recalculating `current` for the old and new
    /// (name, directory) groups unless `current_recalc` is `Skip`. No-op when the path is
    /// `None`.
    pub async fn sync_directory_from_metadata(
        &self,
        file_id: String,
        directory_path: Option<String>,
        current_recalc: CurrentRecalc,
    ) -> Result<(), DirectoryError> {
        let Some(p) = directory_path else {
            return Ok(());
        };
        self.transaction(move |c| {
            let dir = match get_or_create_directory_at_path_stmt(c, &p) {
                Ok(d) => d,
                Err(e) => return Ok(Err(e)),
            };
            if current_recalc == CurrentRecalc::Skip {
                c.execute(
                    "UPDATE files SET directoryId = ? WHERE id = ?",
                    params![dir.id, file_id],
                )?;
                return Ok(Ok(()));
            }
            let old_group = query_file_name_and_directory(c, &file_id)?
                .map(|(name, directory_id)| NameDirGroup { name, directory_id });
            c.execute(
                "UPDATE files SET directoryId = ? WHERE id = ?",
                params![dir.id, file_id],
            )?;
            if let Some(g) = old_group {
                recalculate_current_for_group_stmt(c, &g.name, g.directory_id.as_deref())?;
                recalculate_current_for_group_stmt(c, &g.name, Some(&dir.id))?;
            }
            Ok(Ok(()))
        })
        .await?
    }

    /// Reassigns files into directories from metadata in a single batched pass,
    /// returning the old `(name, directoryId)` groups so the caller can do a single
    /// post-batch `current` recalc. The returned groups are distinct and file-kind
    /// only: a batch with duplicate `(name, directoryId)` pairs collapses to one
    /// group, and a thumb row fed in directly contributes none.
    pub async fn sync_directories_from_metadata(
        &self,
        entries: Vec<DirectorySyncEntry>,
    ) -> Result<Vec<NameDirGroup>, DirectoryError> {
        if entries.is_empty() {
            return Ok(Vec::new());
        }
        self.transaction(move |c| Ok(sync_directories_from_metadata_stmt(c, &entries)))
            .await?
    }

    /// Moves a single file to `dir_id` (root when `None`), recalculating `current`
    /// for both its old and new (name, directory) groups.
    pub async fn move_file_to_directory(
        &self,
        file_id: String,
        dir_id: Option<String>,
    ) -> Result<(), DbError> {
        self.transaction(move |c| {
            let old = query_file_name_and_directory(c, &file_id)?;
            c.execute(
                "UPDATE files SET directoryId = ?, updatedAt = ? WHERE id = ?",
                params![dir_id, Utc::now().timestamp_millis(), file_id],
            )?;
            local_objects::flag_objects_for_files_stmt(c, std::slice::from_ref(&file_id))?;
            // Moving a file changes which row is current in each of the old and new
            // (name, directory) groups, so recalculate both.
            if let Some((name, old_dir)) = old {
                recalculate_current_for_group_stmt(c, &name, old_dir.as_deref())?;
                recalculate_current_for_group_stmt(c, &name, dir_id.as_deref())?;
            }
            Ok(())
        })
        .await
    }

    /// Deletes a directory and its whole subtree, orphaning any files within to root
    /// (`directoryId = NULL`) and recalculating their `current` flags. Never deletes
    /// the files themselves.
    pub async fn delete_directory(&self, id: String) -> Result<(), DbError> {
        self.transaction(move |c| {
            let dir = match query_directory_by_id_stmt(c, &id)? {
                Some(d) => d,
                None => return Ok(()),
            };
            // The subtree always contains at least one id: query_subtree_directory_ids matches
            // `path = ?` as well as the prefix, and `dir.path` itself always matches.
            let subtree = query_subtree_directory_ids(c, &dir.path)?;

            // Capture the affected file ids before the UPDATE nulls directoryId: once
            // directoryId is null the subtree query can no longer find them to flag.
            let affected_ids: Vec<String> = {
                let mut stmt = c.prepare("SELECT id FROM files WHERE directoryId IN rarray(?)")?;
                stmt.query_map([sql::id_array(&subtree)], |r| r.get(0))?
                    .collect::<rusqlite::Result<Vec<String>>>()?
            };

            // Orphan the files to root (directoryId = NULL); deleting a directory must not
            // delete its files, which would be silent data loss. Bump updatedAt so the
            // reparent syncs up.
            c.execute(
                "UPDATE files SET directoryId = NULL, updatedAt = ? WHERE directoryId IN rarray(?)",
                params![Utc::now().timestamp_millis(), sql::id_array(&subtree)],
            )?;
            local_objects::flag_objects_for_files_stmt(c, &affected_ids)?;
            c.execute(
                "DELETE FROM directories WHERE id IN rarray(?)",
                [sql::id_array(&subtree)],
            )?;
            recalculate_current_for_file_ids_stmt(c, &affected_ids)?;
            Ok(())
        })
        .await
    }

    /// Trashes every file version in a directory's subtree (in 500-row batches),
    /// then deletes the directories, returning the count of files trashed.
    pub async fn delete_directory_and_trash_files(&self, id: String) -> Result<u64, DbError> {
        self.transaction(move |c| {
            let dir = match query_directory_by_id_stmt(c, &id)? {
                Some(d) => d,
                None => return Ok(0),
            };
            let prefix = format!("{}/", dir.path);

            // Trash all versions in the subtree (include_old_versions: true), not just the
            // current ones, otherwise superseded versions are left untrashed and the
            // returned count under-reports. The loop terminates because each batch's
            // trash_files_and_thumbnails sets trashedAt, and `active` (no include_trashed)
            // drops those rows from the next LIMIT 500 select. Bounding the working set
            // keeps memory and transaction size flat on very large subtrees.
            let active = build_record_filter(
                "f",
                BuildRecordFilterOpts {
                    include_old_versions: true,
                    ..Default::default()
                },
            );
            let query = format!(
                r"SELECT f.id FROM files f
                  INNER JOIN directories d ON f.directoryId = d.id
                  WHERE (d.path = ? OR {})
                    AND f.kind = 'file' AND {} LIMIT ?",
                starts_with_param("d.path"),
                active
            );
            let mut total_trashed = 0u64;
            let mut stmt = c.prepare(&query)?;
            loop {
                let ids: Vec<String> = stmt
                    .query_map(params![dir.path, prefix, prefix, 500i64], |r| r.get(0))?
                    .collect::<rusqlite::Result<Vec<String>>>()?;
                if ids.is_empty() {
                    break;
                }
                trash::trash_files_and_thumbnails_stmt(c, &ids)?;
                total_trashed += ids.len() as u64;
            }
            drop(stmt);

            // Detach every remaining subtree file (the just-trashed batch AND rows that were
            // already trashed/tombstoned before the call) before the directory rows go away:
            // a dangling directoryId is neither in a folder nor unfiled, so the file would
            // vanish from every browse view. The bump + flag sync the reparent.
            let subtree: Vec<String> = {
                let mut stmt = c.prepare(&format!(
                    "SELECT id FROM directories WHERE path = ? OR {}",
                    starts_with_param("path")
                ))?;
                stmt.query_map(params![dir.path, prefix, prefix], |r| r.get(0))?
                    .collect::<rusqlite::Result<Vec<String>>>()?
            };
            let detached: Vec<String> = {
                let mut stmt = c.prepare("SELECT id FROM files WHERE directoryId IN rarray(?)")?;
                stmt.query_map([sql::id_array(&subtree)], |r| r.get(0))?
                    .collect::<rusqlite::Result<Vec<String>>>()?
            };
            c.execute(
                "UPDATE files SET directoryId = NULL, updatedAt = ? WHERE id IN rarray(?)",
                params![Utc::now().timestamp_millis(), sql::id_array(&detached)],
            )?;
            local_objects::flag_objects_for_files_stmt(c, &detached)?;

            c.execute(
                &format!(
                    "DELETE FROM directories WHERE path = ? OR {}",
                    starts_with_param("path")
                ),
                params![dir.path, prefix, prefix],
            )?;

            Ok(total_trashed)
        })
        .await
    }

    /// Deletes directories that have no active files and no subdirectories.
    /// Walks up the tree one level per iteration: if removing a directory makes
    /// its parent empty, the parent is evaluated on the next pass.
    pub async fn delete_empty_directories(
        &self,
        directory_ids: Vec<String>,
    ) -> Result<u64, DbError> {
        if directory_ids.is_empty() {
            return Ok(0);
        }
        self.transaction(move |c| delete_empty_directories_stmt(c, &directory_ids))
            .await
    }

    /// Counts how many of `file_ids` are active files assigned to some directory
    /// (`directoryId IS NOT NULL`).
    pub async fn count_files_with_directories(
        &self,
        file_ids: Vec<String>,
    ) -> Result<u64, DbError> {
        if file_ids.is_empty() {
            return Ok(0);
        }
        self.transaction(move |c| {
            let active = build_record_filter("f", BuildRecordFilterOpts::default());
            let q = format!(
                "SELECT COUNT(*) FROM files f WHERE f.id IN rarray(?) AND f.directoryId IS NOT NULL AND {active}"
            );
            Ok(c.query_row(&q, [sql::id_array(&file_ids)], |r| r.get(0))?)
        })
        .await
    }

    /// Returns the active newest-version file named `file_name` directly in
    /// `directory_path` (`ORDER BY updatedAt DESC, id DESC LIMIT 1`), or `None` when
    /// no match exists.
    pub async fn query_file_by_name_in_directory(
        &self,
        file_name: String,
        directory_path: String,
    ) -> Result<Option<FileRecordRow>, DbError> {
        if file_name.is_empty() {
            return Ok(None);
        }
        self.transaction(move |c| {
            let active = build_record_filter("f", BuildRecordFilterOpts::default());
            let q = format!(
                r"SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind, f.localId,
                         f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt, f.deletedAt, f.lostReason
                  FROM files f
                  INNER JOIN directories d ON f.directoryId = d.id
                  WHERE f.name = ? AND {active}
                    AND d.path = ?
                  ORDER BY f.updatedAt DESC, f.id DESC
                  LIMIT 1"
            );
            Ok(c.query_row(
                &q,
                params![file_name, directory_path],
                file_record_row_from_db_row,
            )
            .optional()?)
        })
        .await
    }

    /// Renames a directory's last path segment (keeping its parent), rebasing every
    /// descendant path and bumping affected files' `updatedAt` so the change syncs.
    /// Errors if a sibling already has the new name.
    pub async fn rename_directory(
        &self,
        dir_id: String,
        name: String,
    ) -> Result<Directory, DirectoryError> {
        let trimmed = sanitize_directory_segment(&name);
        if trimmed.is_empty() {
            return Err(DirectoryError::EmptyName);
        }
        self.transaction(move |c| {
            let dir = match query_directory_by_id_stmt(c, &dir_id)? {
                Some(d) => d,
                None => return Ok(Err(DirectoryError::NotFound)),
            };
            let parent_path = directory_parent_path(&dir.path).unwrap_or_default();
            let new_path = if parent_path.is_empty() {
                trimmed.clone()
            } else {
                format!("{}/{}", parent_path, trimmed)
            };
            if new_path == dir.path {
                // Same-name rename: nothing to rebase, and no descendant may be touched (a
                // rewrite would bump every subtree file and re-push them all for nothing).
                return Ok(Ok(dir));
            }
            if query_directory_id_at_path_excluding(c, &new_path, &dir_id)?.is_some() {
                return Ok(Err(DirectoryError::AlreadyExists(new_path)));
            }
            rebase_directory_tree(c, &dir_id, &dir.path, &new_path)?;
            Ok(Ok(Directory {
                id: dir_id,
                path: new_path.clone(),
                name: directory_display_name(&new_path),
                created_at: dir.created_at,
            }))
        })
        .await?
    }

    /// Moves a directory under `new_parent_path` (root when `None`), rebasing every
    /// descendant path and bumping affected files' `updatedAt` so the change syncs.
    /// Errors on moving into itself/a subfolder, or a name collision at the destination.
    pub async fn move_directory(
        &self,
        dir_id: String,
        new_parent_path: Option<String>,
    ) -> Result<(), DirectoryError> {
        self.transaction(move |c| {
            let dir = match query_directory_by_id_stmt(c, &dir_id)? {
                Some(d) => d,
                None => return Ok(Err(DirectoryError::NotFound)),
            };
            let leaf_name = directory_display_name(&dir.path);
            let new_path = match new_parent_path.as_deref() {
                Some(p) => format!("{}/{}", p, leaf_name),
                None => leaf_name.clone(),
            };
            if let Some(p) = new_parent_path.as_deref() {
                if p == dir.path || p.starts_with(&format!("{}/", dir.path)) {
                    return Ok(Err(DirectoryError::MoveIntoSelf));
                }
                // The destination parent must exist: rebasing under a nonexistent path would
                // write orphan paths ("Ghost/leaf") that no root or children listing can reach.
                if query_directory_id_by_path(c, p)?.is_none() {
                    return Ok(Err(DirectoryError::NotFound));
                }
            }
            if new_path == dir.path {
                return Ok(Ok(()));
            }
            if query_directory_id_at_path_excluding(c, &new_path, &dir_id)?.is_some() {
                return Ok(Err(DirectoryError::AlreadyExistsAtDest(leaf_name)));
            }
            rebase_directory_tree(c, &dir_id, &dir.path, &new_path)?;
            Ok(Ok(()))
        })
        .await?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::operations::files::InsertFileOptions;
    use crate::types::files::{FileKind, FileRecordRow, ThumbSize};

    async fn test_db() -> Db {
        Db::open_in_memory().await.unwrap()
    }

    async fn create_test_file(db: &Db, id: &str) {
        db.insert_file(
            FileRecordRow::test(id).clone(),
            InsertFileOptions::default(),
        )
        .await
        .expect("insert test file");
    }

    /// Inserts a file row with a caller-chosen name and kind, skipping the
    /// current-recalc so arbitrary (name, kind) sets are cheap to build.
    async fn insert_named_file(db: &Db, id: &str, name: &str, kind: FileKind) {
        let row = FileRecordRow::test(id).name(name);
        let row = match kind {
            FileKind::Thumb => row.thumb_for("orig", ThumbSize::S512),
            FileKind::File => row.kind(FileKind::File),
        };
        db.insert_file(
            row.clone(),
            InsertFileOptions {
                current_recalc: CurrentRecalc::Skip,
            },
        )
        .await
        .expect("insert named file");
    }

    /// Assigns a file to a directory without bumping updatedAt, so a later
    /// rename/move bump is observable against the seeded baseline.
    async fn assign_dir(db: &Db, file_id: &str, dir_id: &str) {
        let (file_id, dir_id) = (file_id.to_string(), dir_id.to_string());
        db.transaction(move |c| {
            c.execute(
                "UPDATE files SET directoryId = ? WHERE id = ?",
                params![dir_id, file_id],
            )?;
            Ok(())
        })
        .await
        .expect("assign dir");
    }

    async fn list_all_paths(db: &Db) -> Vec<String> {
        db.transaction(|c| {
            let mut stmt = c.prepare("SELECT path FROM directories ORDER BY path")?;
            Ok(stmt
                .query_map([], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<String>>>()?)
        })
        .await
        .unwrap()
    }

    async fn directory_id_of(db: &Db, file_id: &str) -> Option<String> {
        let file_id = file_id.to_string();
        db.transaction(move |c| {
            Ok(c.query_row(
                "SELECT directoryId FROM files WHERE id = ?",
                params![file_id],
                |r| r.get(0),
            )?)
        })
        .await
        .unwrap()
    }

    fn entry(file_id: &str, directory_path: &str) -> DirectorySyncEntry {
        DirectorySyncEntry {
            file_id: file_id.to_string(),
            directory_path: directory_path.to_string(),
        }
    }

    async fn updated_at(db: &Db, id: &str) -> i64 {
        db.query_file_by_id(id.to_string())
            .await
            .expect("query")
            .expect("row")
            .updated_at
    }

    #[test]
    fn directory_display_name_returns_full_string_for_root() {
        assert_eq!(directory_display_name("Photos"), "Photos");
    }

    #[test]
    fn directory_display_name_returns_leaf_segment_for_nested() {
        assert_eq!(directory_display_name("A/B/C/D"), "D");
    }

    #[test]
    fn directory_parent_path_returns_null_for_root() {
        assert_eq!(directory_parent_path("Photos"), None);
    }

    #[test]
    fn directory_parent_path_returns_parent_for_nested() {
        assert_eq!(directory_parent_path("A/B/C/D"), Some("A/B/C".to_string()));
    }

    #[test]
    fn sanitize_directory_segment_strips_forward_slashes() {
        assert_eq!(sanitize_directory_segment("a/b/c"), "abc");
    }

    #[test]
    fn sanitize_directory_segment_strips_backslashes() {
        assert_eq!(sanitize_directory_segment("a\\b"), "ab");
    }

    #[test]
    fn sanitize_directory_segment_strips_control_and_del_characters() {
        assert_eq!(
            sanitize_directory_segment("he\u{0000}llo\u{007f}world\u{001f}"),
            "helloworld"
        );
    }

    #[test]
    fn sanitize_directory_segment_rejects_dot_runs_as_empty() {
        assert_eq!(sanitize_directory_segment("."), "");
        assert_eq!(sanitize_directory_segment(".."), "");
    }

    #[test]
    fn sanitize_directory_segment_trims_whitespace() {
        assert_eq!(sanitize_directory_segment("  hello  "), "hello");
    }

    #[test]
    fn sanitize_directory_segment_truncates_to_255_characters() {
        let long = "a".repeat(300);
        assert_eq!(sanitize_directory_segment(&long), "a".repeat(255));
    }

    // The UTF-16-code-unit truncation boundary: an astral char (`len_utf16() == 2`)
    // costs two units. A run of 200 astral chars is 400 code units; the cap admits
    // the first 127 whole chars (254 units) and stops, since the 128th would reach
    // 256. Counting scalars instead would keep all 200, diverging here.
    #[test]
    fn sanitize_directory_segment_truncates_astral_chars_by_utf16_units() {
        let long = "\u{1F600}".repeat(200);
        let out = sanitize_directory_segment(&long);
        assert_eq!(out.chars().count(), 127);
        assert_eq!(out.chars().map(|c| c.len_utf16()).sum::<usize>(), 254);
    }

    // A char that would split across the 255th UTF-16 unit is dropped whole: 254
    // ASCII plus one astral char would land at 256, so the astral char is excluded.
    #[test]
    fn sanitize_directory_segment_drops_astral_char_that_would_straddle_the_cap() {
        let input = format!("{}\u{1F600}", "a".repeat(254));
        assert_eq!(sanitize_directory_segment(&input), "a".repeat(254));
    }

    // A char that exactly fills the cap is kept: 253 ASCII + one astral char (2
    // units) = 255 units, all retained.
    #[test]
    fn sanitize_directory_segment_keeps_astral_char_that_exactly_fills_the_cap() {
        let input = format!("{}\u{1F600}", "a".repeat(253));
        let out = sanitize_directory_segment(&input);
        assert_eq!(out, format!("{}\u{1F600}", "a".repeat(253)));
        assert_eq!(out.chars().map(|c| c.len_utf16()).sum::<usize>(), 255);
    }

    #[tokio::test]
    async fn insert_directory_creates_a_root_directory() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("insert");
        assert!(!dir.id.is_empty());
        assert_eq!(dir.path, "Photos");
        assert_eq!(dir.name, "Photos");
        assert!(dir.created_at > 0);
    }

    #[tokio::test]
    async fn insert_directory_creates_a_nested_directory() {
        let db = test_db().await;
        db.insert_directory("Photos".to_string(), None)
            .await
            .expect("root");
        let dir = db
            .insert_directory("Vacation".to_string(), Some("Photos".to_string()))
            .await
            .expect("nested");
        assert_eq!(dir.path, "Photos/Vacation");
        assert_eq!(dir.name, "Vacation");
    }

    #[tokio::test]
    async fn insert_directory_fails_on_empty_name() {
        let db = test_db().await;
        let err = db.insert_directory("".to_string(), None).await.unwrap_err();
        assert!(matches!(err, DirectoryError::EmptyName));
    }

    #[tokio::test]
    async fn insert_directory_fails_on_duplicate_path() {
        let db = test_db().await;
        db.insert_directory("Photos".to_string(), None)
            .await
            .expect("first");
        let err = db
            .insert_directory("Photos".to_string(), None)
            .await
            .unwrap_err();
        assert!(matches!(err, DirectoryError::AlreadyExists(_)));
    }

    #[tokio::test]
    async fn insert_directory_sanitizes_slashes_from_the_name() {
        let db = test_db().await;
        let dir = db
            .insert_directory("my/folder\\name".to_string(), None)
            .await
            .expect("insert");
        assert_eq!(dir.name, "myfoldername");
    }

    #[tokio::test]
    async fn paths_are_case_sensitive() {
        let db = test_db().await;
        let lower = db
            .insert_directory("photos".to_string(), None)
            .await
            .expect("lower");
        let upper = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("upper");
        assert_ne!(lower.id, upper.id);
    }

    #[tokio::test]
    async fn get_or_create_directory_returns_existing_on_second_call() {
        let db = test_db().await;
        let first = db
            .get_or_create_directory("Vacation".to_string(), Some("Photos".to_string()))
            .await
            .expect("first");
        let second = db
            .get_or_create_directory("Vacation".to_string(), Some("Photos".to_string()))
            .await
            .expect("second");
        assert_eq!(first.id, second.id);
        assert_eq!(first.path, "Photos/Vacation");
    }

    #[tokio::test]
    async fn get_or_create_directory_at_path_creates_intermediate_directories() {
        let db = test_db().await;
        let dir = db
            .get_or_create_directory_at_path("Photos/Vacation".to_string())
            .await
            .expect("create");
        assert_eq!(dir.path, "Photos/Vacation");
        assert_eq!(list_all_paths(&db).await, vec!["Photos", "Photos/Vacation"]);
    }

    #[tokio::test]
    async fn get_or_create_directory_at_path_reuses_existing_intermediate_dirs() {
        let db = test_db().await;
        let existing = db
            .get_or_create_directory_at_path("Photos".to_string())
            .await
            .expect("existing");
        db.get_or_create_directory_at_path("Photos/Vacation".to_string())
            .await
            .expect("create");
        assert!(
            db.query_directory_by_id(existing.id.clone())
                .await
                .expect("query")
                .is_some()
        );
        assert_eq!(list_all_paths(&db).await, vec!["Photos", "Photos/Vacation"]);
    }

    #[tokio::test]
    async fn query_directory_children_returns_root_children_with_counts() {
        let db = test_db().await;
        let photos = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        db.insert_directory("Vacation".to_string(), Some("Photos".to_string()))
            .await
            .expect("vacation");
        db.insert_directory("Videos".to_string(), None)
            .await
            .expect("videos");
        create_test_file(&db, "f1").await;
        db.move_file_to_directory("f1".to_string(), Some(photos.id.clone()))
            .await
            .expect("move");

        let roots = db.query_directory_children(None).await.expect("roots");
        let mut names: Vec<String> = roots.iter().map(|d| d.directory.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["Photos", "Videos"]);
        let photos_row = roots.iter().find(|d| d.directory.name == "Photos").unwrap();
        assert_eq!(photos_row.file_count, 1);
        assert_eq!(photos_row.subdirectory_count, 1);
    }

    #[tokio::test]
    async fn query_directory_children_counts_files_recursively_across_descendants() {
        let db = test_db().await;
        db.insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        db.insert_directory("Trips".to_string(), Some("Photos".to_string()))
            .await
            .expect("trips");
        let italy = db
            .insert_directory("Italy".to_string(), Some("Photos/Trips".to_string()))
            .await
            .expect("italy");
        create_test_file(&db, "f1").await;
        db.move_file_to_directory("f1".to_string(), Some(italy.id.clone()))
            .await
            .expect("move");

        let roots = db.query_directory_children(None).await.expect("roots");
        let photos = roots.iter().find(|d| d.directory.name == "Photos").unwrap();
        assert_eq!(photos.file_count, 1);
    }

    // 'a_b' must count only its own child: the substr prefix compare is literal, so a
    // wildcard-style match (where '_' matches 'x') would over-count 'a_b' to 2 via
    // 'axb/kid'. Both parents carry one child so the assertion can actually fail.
    #[tokio::test]
    async fn query_directory_children_treats_underscore_literally() {
        let db = test_db().await;
        db.insert_directory("a_b".to_string(), None)
            .await
            .expect("a_b");
        db.insert_directory("axb".to_string(), None)
            .await
            .expect("axb");
        db.insert_directory("child".to_string(), Some("a_b".to_string()))
            .await
            .expect("child");
        db.insert_directory("kid".to_string(), Some("axb".to_string()))
            .await
            .expect("kid");

        let roots = db.query_directory_children(None).await.expect("roots");
        let a_und_b = roots.iter().find(|d| d.directory.name == "a_b").unwrap();
        let axb = roots.iter().find(|d| d.directory.name == "axb").unwrap();
        assert_eq!(a_und_b.subdirectory_count, 1);
        assert_eq!(axb.subdirectory_count, 1);
    }

    // A '%' in the parent path is literal under the substr compare: '50% off' must
    // list only its own child, and the adversarial sibling '50X off/other' (which a
    // wildcard match would admit) stays out.
    #[tokio::test]
    async fn query_directory_children_treats_percent_literally() {
        let db = test_db().await;
        db.insert_directory("50% off".to_string(), None)
            .await
            .expect("50% off");
        db.insert_directory("child".to_string(), Some("50% off".to_string()))
            .await
            .expect("child");
        db.insert_directory("50X off".to_string(), None)
            .await
            .expect("50X off");
        db.insert_directory("other".to_string(), Some("50X off".to_string()))
            .await
            .expect("other");

        let children = db
            .query_directory_children(Some("50% off".to_string()))
            .await
            .expect("children");
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].directory.name, "child");
    }

    #[tokio::test]
    async fn query_all_directories_with_counts_excludes_trashed_files() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        create_test_file(&db, "f1").await;
        create_test_file(&db, "f2").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move f1");
        db.move_file_to_directory("f2".to_string(), Some(dir.id.clone()))
            .await
            .expect("move f2");
        db.transaction(|c| {
            c.execute(
                "UPDATE files SET trashedAt = ? WHERE id = ?",
                params![Utc::now().timestamp_millis(), "f2"],
            )?;
            Ok(())
        })
        .await
        .expect("trash f2");

        let dirs = db.query_all_directories_with_counts().await.expect("all");
        assert_eq!(dirs[0].file_count, 1);
    }

    #[tokio::test]
    async fn query_directory_path_for_file_returns_nested_path() {
        let db = test_db().await;
        db.insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        let vacation = db
            .insert_directory("Vacation".to_string(), Some("Photos".to_string()))
            .await
            .expect("vacation");
        create_test_file(&db, "f1").await;
        db.move_file_to_directory("f1".to_string(), Some(vacation.id.clone()))
            .await
            .expect("move");

        assert_eq!(
            db.query_directory_path_for_file("f1".to_string())
                .await
                .expect("p"),
            Some("Photos/Vacation".to_string())
        );
    }

    #[tokio::test]
    async fn query_directory_path_for_file_returns_none_when_unfiled() {
        let db = test_db().await;
        create_test_file(&db, "f1").await;
        assert_eq!(
            db.query_directory_path_for_file("f1".to_string())
                .await
                .expect("p"),
            None
        );
    }

    #[tokio::test]
    async fn move_file_to_directory_moves_in_then_out() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        create_test_file(&db, "f1").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move in");
        assert_eq!(
            db.query_directory_path_for_file("f1".to_string())
                .await
                .expect("p"),
            Some("Photos".to_string())
        );
        db.move_file_to_directory("f1".to_string(), None)
            .await
            .expect("move out");
        assert_eq!(
            db.query_directory_path_for_file("f1".to_string())
                .await
                .expect("p"),
            None
        );
    }

    #[tokio::test]
    async fn move_file_to_directory_bumps_updated_at() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        create_test_file(&db, "f1").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move");
        assert!(updated_at(&db, "f1").await > 1000);
    }

    #[tokio::test]
    async fn sync_directory_from_metadata_creates_intermediate_dirs_and_assigns() {
        let db = test_db().await;
        create_test_file(&db, "f1").await;
        db.sync_directory_from_metadata(
            "f1".to_string(),
            Some("Photos/Vacation".to_string()),
            CurrentRecalc::Run,
        )
        .await
        .expect("sync");
        assert_eq!(
            db.query_directory_path_for_file("f1".to_string())
                .await
                .expect("p"),
            Some("Photos/Vacation".to_string())
        );
        assert_eq!(list_all_paths(&db).await.len(), 2);
    }

    #[tokio::test]
    async fn sync_directory_from_metadata_preserves_when_path_is_none() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        create_test_file(&db, "f1").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move");
        db.sync_directory_from_metadata("f1".to_string(), None, CurrentRecalc::Run)
            .await
            .expect("sync");
        assert_eq!(
            db.query_directory_path_for_file("f1".to_string())
                .await
                .expect("p"),
            Some("Photos".to_string())
        );
    }

    #[tokio::test]
    async fn sync_directories_from_metadata_creates_all_path_prefixes() {
        let db = test_db().await;
        create_test_file(&db, "f1").await;
        db.sync_directories_from_metadata(vec![entry("f1", "a/b/c")])
            .await
            .expect("sync");
        assert_eq!(list_all_paths(&db).await, vec!["a", "a/b", "a/b/c"]);
        assert!(directory_id_of(&db, "f1").await.is_some());
    }

    #[tokio::test]
    async fn sync_directories_from_metadata_dedups_shared_prefixes() {
        let db = test_db().await;
        create_test_file(&db, "f1").await;
        create_test_file(&db, "f2").await;
        db.sync_directories_from_metadata(vec![entry("f1", "a/b/c"), entry("f2", "a/b/d")])
            .await
            .expect("sync");
        assert_eq!(
            list_all_paths(&db).await,
            vec!["a", "a/b", "a/b/c", "a/b/d"]
        );
    }

    #[tokio::test]
    async fn sync_directories_from_metadata_skips_path_that_sanitizes_to_empty() {
        let db = test_db().await;
        create_test_file(&db, "f1").await;
        db.sync_directories_from_metadata(vec![entry("f1", "...")])
            .await
            .expect("sync");
        assert!(list_all_paths(&db).await.is_empty());
        assert!(directory_id_of(&db, "f1").await.is_none());
    }

    // The sole prod caller (sync-down) feeds the returned old `(name, directoryId)`
    // groups into a consolidated `current` recalc; the op never recalcs itself.
    #[tokio::test]
    async fn sync_directories_from_metadata_returns_previous_groups() {
        let db = test_db().await;
        let old_dir = db
            .get_or_create_directory_at_path("old".to_string())
            .await
            .expect("seed dir");
        create_test_file(&db, "f1").await;
        assign_dir(&db, "f1", &old_dir.id).await;

        let old_groups = db
            .sync_directories_from_metadata(vec![entry("f1", "new")])
            .await
            .expect("sync");
        assert_eq!(old_groups.len(), 1);
        assert_eq!(old_groups[0].name, "f1.jpg");
        assert_eq!(
            old_groups[0].directory_id.as_deref(),
            Some(old_dir.id.as_str())
        );
        assert_eq!(
            db.query_directory_path_for_file("f1".to_string())
                .await
                .expect("p"),
            Some("new".to_string())
        );
    }

    // The old-groups query filters `kind = 'file'` and DISTINCT, so a thumb row
    // fed in directly contributes no group and same-(name, dir) files collapse.
    #[tokio::test]
    async fn sync_directories_from_metadata_excludes_thumb_rows_from_groups() {
        let db = test_db().await;
        let old_dir = db
            .get_or_create_directory_at_path("old".to_string())
            .await
            .expect("seed dir");
        insert_named_file(&db, "f1", "real.jpg", FileKind::File).await;
        insert_named_file(&db, "t1", "thumb.jpg", FileKind::Thumb).await;
        assign_dir(&db, "f1", &old_dir.id).await;
        assign_dir(&db, "t1", &old_dir.id).await;

        let old_groups = db
            .sync_directories_from_metadata(vec![entry("f1", "new"), entry("t1", "new")])
            .await
            .expect("sync");
        assert_eq!(old_groups.len(), 1);
        assert_eq!(old_groups[0].name, "real.jpg");
    }

    #[tokio::test]
    async fn sync_directories_from_metadata_empty_is_noop() {
        let db = test_db().await;
        assert!(
            db.sync_directories_from_metadata(vec![])
                .await
                .expect("sync")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn count_files_with_directories_counts_filed_files() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        create_test_file(&db, "f1").await;
        create_test_file(&db, "f2").await;
        create_test_file(&db, "f3").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move f1");
        db.move_file_to_directory("f2".to_string(), Some(dir.id.clone()))
            .await
            .expect("move f2");

        let count = db
            .count_files_with_directories(vec!["f1".into(), "f2".into(), "f3".into()])
            .await
            .expect("count");
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn rename_directory_renames_and_updates_descendant_paths() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        db.insert_directory("Vacation".to_string(), Some("Photos".to_string()))
            .await
            .expect("vacation");
        db.insert_directory("2025".to_string(), Some("Photos/Vacation".to_string()))
            .await
            .expect("2025");

        let updated = db
            .rename_directory(dir.id.clone(), "Images".to_string())
            .await
            .expect("rename");
        assert_eq!(updated.path, "Images");
        let mut paths = list_all_paths(&db).await;
        paths.sort();
        assert_eq!(
            paths,
            vec!["Images", "Images/Vacation", "Images/Vacation/2025"]
        );
    }

    #[tokio::test]
    async fn rename_directory_is_case_sensitive() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        db.insert_directory("Album".to_string(), Some("Photos".to_string()))
            .await
            .expect("album");
        // `photos` is a different directory from `Photos`; renaming `Photos` must not touch it.
        db.insert_directory("photos".to_string(), None)
            .await
            .expect("photos-lower");
        db.insert_directory("Other".to_string(), Some("photos".to_string()))
            .await
            .expect("other");

        db.rename_directory(dir.id.clone(), "Pictures".to_string())
            .await
            .expect("rename");

        let mut paths = list_all_paths(&db).await;
        paths.sort();
        assert_eq!(
            paths,
            vec!["Pictures", "Pictures/Album", "photos", "photos/Other"]
        );
    }

    #[tokio::test]
    async fn delete_directory_is_case_sensitive() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        db.insert_directory("photos".to_string(), None)
            .await
            .expect("photos-lower");
        db.insert_directory("Other".to_string(), Some("photos".to_string()))
            .await
            .expect("other");

        db.delete_directory(dir.id.clone()).await.expect("delete");

        let mut paths = list_all_paths(&db).await;
        paths.sort();
        assert_eq!(paths, vec!["photos", "photos/Other"]);
    }

    /// Inserts an object for `file_id` and clears its dirty flag, so a later flag
    /// set by the op under test is observable.
    async fn seed_clean_object(db: &Db, file_id: &str, object_id: &str) {
        use crate::types::local_object::LocalObject;
        use chrono::TimeZone;
        use sia_storage::{SealedObject, Signature};
        let (file_id, object_id) = (file_id.to_string(), object_id.to_string());
        db.transaction(move |c| {
            let ts = Utc.timestamp_millis_opt(1000).unwrap();
            local_objects::upsert_object_stmt(
                c,
                &LocalObject {
                    id: object_id.clone(),
                    file_id,
                    indexer_url: "https://a.com".into(),
                    sealed: SealedObject {
                        encrypted_data_key: vec![0u8; 3],
                        slabs: Vec::new(),
                        data_signature: Signature::try_from(&[0u8; 64][..]).unwrap(),
                        encrypted_metadata_key: vec![0u8; 3],
                        encrypted_metadata: vec![0u8; 3],
                        metadata_signature: Signature::try_from(&[0u8; 64][..]).unwrap(),
                        created_at: ts,
                        updated_at: ts,
                    },
                },
            )?;
            c.execute(
                "UPDATE objects SET needsSyncUp = 0 WHERE id = ?",
                params![object_id],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn rename_directory_flags_subtree_objects_for_sync_up() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        create_test_file(&db, "f1").await;
        assign_dir(&db, "f1", &dir.id).await;
        seed_clean_object(&db, "f1", "obj1").await;

        db.rename_directory(dir.id.clone(), "Images".to_string())
            .await
            .expect("rename");

        let flag = db
            .transaction(|c| {
                Ok(c.query_row(
                    "SELECT needsSyncUp FROM objects WHERE id = 'obj1'",
                    [],
                    |r| r.get::<_, i64>(0),
                )?)
            })
            .await
            .unwrap();
        assert_eq!(flag, 1, "a folder rename must re-push its files' objects");
    }

    #[tokio::test]
    async fn rename_directory_fails_on_empty_name() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        assert!(matches!(
            db.rename_directory(dir.id.clone(), "".to_string())
                .await
                .unwrap_err(),
            DirectoryError::EmptyName
        ));
    }

    #[tokio::test]
    async fn rename_directory_fails_on_duplicate_name() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        db.insert_directory("Videos".to_string(), None)
            .await
            .expect("videos");
        assert!(matches!(
            db.rename_directory(dir.id.clone(), "Videos".to_string())
                .await
                .unwrap_err(),
            DirectoryError::AlreadyExists(_)
        ));
    }

    #[tokio::test]
    async fn rename_directory_bumps_updated_at_on_subtree_files() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        let vacation = db
            .insert_directory("Vacation".to_string(), Some("Photos".to_string()))
            .await
            .expect("vacation");
        create_test_file(&db, "f1").await;
        create_test_file(&db, "f2").await;
        assign_dir(&db, "f1", &dir.id).await;
        assign_dir(&db, "f2", &vacation.id).await;

        db.rename_directory(dir.id.clone(), "Images".to_string())
            .await
            .expect("rename");
        assert!(updated_at(&db, "f1").await > 1000);
        assert!(updated_at(&db, "f2").await > 1000);
    }

    #[tokio::test]
    async fn delete_directory_orphans_subtree_files_to_root() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        let sub = db
            .insert_directory("A".to_string(), Some("Photos".to_string()))
            .await
            .expect("A");
        db.insert_directory("B".to_string(), Some("Photos/A".to_string()))
            .await
            .expect("B");
        create_test_file(&db, "f1").await;
        create_test_file(&db, "f2").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move f1");
        db.move_file_to_directory("f2".to_string(), Some(sub.id.clone()))
            .await
            .expect("move f2");

        db.delete_directory(dir.id.clone()).await.expect("delete");
        assert!(list_all_paths(&db).await.is_empty());
        assert_eq!(
            db.query_directory_path_for_file("f1".to_string())
                .await
                .expect("p1"),
            None
        );
        assert_eq!(
            db.query_directory_path_for_file("f2".to_string())
                .await
                .expect("p2"),
            None
        );
    }

    #[tokio::test]
    async fn delete_directory_leaves_siblings_untouched() {
        let db = test_db().await;
        let photos = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        db.insert_directory("Videos".to_string(), None)
            .await
            .expect("videos");
        let work = db
            .insert_directory("Work".to_string(), Some("Videos".to_string()))
            .await
            .expect("work");
        create_test_file(&db, "f1").await;
        create_test_file(&db, "f2").await;
        db.move_file_to_directory("f1".to_string(), Some(photos.id.clone()))
            .await
            .expect("move f1");
        db.move_file_to_directory("f2".to_string(), Some(work.id.clone()))
            .await
            .expect("move f2");

        db.delete_directory(photos.id.clone())
            .await
            .expect("delete");
        let mut paths = list_all_paths(&db).await;
        paths.sort();
        assert_eq!(paths, vec!["Videos", "Videos/Work"]);
        assert_eq!(
            db.query_directory_path_for_file("f2".to_string())
                .await
                .expect("p2"),
            Some("Videos/Work".to_string())
        );
    }

    #[tokio::test]
    async fn delete_directory_and_trash_files_trashes_every_level_and_deletes_subtree() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        let vacation = db
            .insert_directory("Vacation".to_string(), Some("Photos".to_string()))
            .await
            .expect("vacation");
        let deep = db
            .insert_directory("2025".to_string(), Some("Photos/Vacation".to_string()))
            .await
            .expect("deep");
        create_test_file(&db, "f1").await;
        create_test_file(&db, "f2").await;
        create_test_file(&db, "f3").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move f1");
        db.move_file_to_directory("f2".to_string(), Some(vacation.id.clone()))
            .await
            .expect("move f2");
        db.move_file_to_directory("f3".to_string(), Some(deep.id.clone()))
            .await
            .expect("move f3");

        assert_eq!(
            db.delete_directory_and_trash_files(dir.id.clone())
                .await
                .expect("delete"),
            3
        );
        assert!(list_all_paths(&db).await.is_empty());
        for id in ["f1", "f2", "f3"] {
            assert!(
                db.query_file_by_id(id.to_string())
                    .await
                    .expect("q")
                    .expect("row")
                    .trashed_at
                    .is_some()
            );
        }
    }

    #[tokio::test]
    async fn delete_directory_and_trash_files_skips_already_trashed() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        create_test_file(&db, "f1").await;
        create_test_file(&db, "f2").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move f1");
        db.move_file_to_directory("f2".to_string(), Some(dir.id.clone()))
            .await
            .expect("move f2");
        db.transaction(|c| {
            c.execute(
                "UPDATE files SET trashedAt = ? WHERE id = ?",
                params![Utc::now().timestamp_millis(), "f2"],
            )?;
            Ok(())
        })
        .await
        .expect("trash f2");

        assert_eq!(
            db.delete_directory_and_trash_files(dir.id.clone())
                .await
                .expect("delete"),
            1
        );
    }

    // The trash loop processes the subtree in 500-row batches via re-SELECT, so a
    // directory holding more than 500 files trashes every one and returns the full
    // count. Exercises more than two loop iterations.
    #[tokio::test]
    async fn delete_directory_and_trash_files_handles_more_than_500_files() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Big".to_string(), None)
            .await
            .expect("big");
        let n = 1001;
        for i in 0..n {
            let id = format!("big-{i}");
            insert_named_file(&db, &id, &format!("{id}.jpg"), FileKind::File).await;
        }
        let dir_id = dir.id.clone();
        db.transaction(move |c| {
            c.execute(
                "UPDATE files SET directoryId = ? WHERE directoryId IS NULL AND kind = 'file'",
                params![dir_id],
            )?;
            Ok(())
        })
        .await
        .expect("assign all to dir");

        assert_eq!(
            db.delete_directory_and_trash_files(dir.id.clone())
                .await
                .expect("delete"),
            n
        );
        assert!(
            db.query_all_directories_with_counts()
                .await
                .expect("all")
                .is_empty()
        );
        let remaining = db
            .transaction(|c| {
                Ok(c.query_row(
                    "SELECT COUNT(*) FROM files WHERE trashedAt IS NULL",
                    [],
                    |r| r.get::<_, i64>(0),
                )?)
            })
            .await
            .expect("count");
        assert_eq!(remaining, 0);
    }

    // A directory named with a wildcard-ish char ('a_b') matches only its own
    // descendants, never a sibling ('axb'): the substr prefix compare is literal.
    #[tokio::test]
    async fn delete_directory_and_trash_files_subtree_match_is_literal() {
        let db = test_db().await;
        let a_und_b = db
            .insert_directory("a_b".to_string(), None)
            .await
            .expect("a_b");
        let child = db
            .insert_directory("child".to_string(), Some("a_b".to_string()))
            .await
            .expect("child");
        db.insert_directory("axb".to_string(), None)
            .await
            .expect("axb");
        let sibling_child = db
            .insert_directory("child".to_string(), Some("axb".to_string()))
            .await
            .expect("axb child");
        create_test_file(&db, "f1").await;
        create_test_file(&db, "f2").await;
        create_test_file(&db, "f3").await;
        db.move_file_to_directory("f1".to_string(), Some(a_und_b.id.clone()))
            .await
            .expect("move f1");
        db.move_file_to_directory("f2".to_string(), Some(child.id.clone()))
            .await
            .expect("move f2");
        db.move_file_to_directory("f3".to_string(), Some(sibling_child.id.clone()))
            .await
            .expect("move f3");

        assert_eq!(
            db.delete_directory_and_trash_files(a_und_b.id.clone())
                .await
                .expect("delete"),
            2
        );
        assert_eq!(
            db.query_file_by_id("f3".to_string())
                .await
                .expect("q")
                .expect("row")
                .trashed_at,
            None
        );
        let mut paths: Vec<String> = db
            .query_all_directories_with_counts()
            .await
            .expect("all")
            .iter()
            .map(|d| d.directory.path.clone())
            .collect();
        paths.sort();
        assert_eq!(paths, vec!["axb", "axb/child"]);
    }

    #[tokio::test]
    async fn delete_empty_directories_deletes_an_empty_directory() {
        let db = test_db().await;
        let dir = db
            .insert_directory("target".to_string(), None)
            .await
            .expect("target");
        assert_eq!(
            db.delete_empty_directories(vec![dir.id])
                .await
                .expect("del"),
            1
        );
    }

    #[tokio::test]
    async fn delete_empty_directories_keeps_directory_with_active_files() {
        let db = test_db().await;
        let dir = db
            .insert_directory("full".to_string(), None)
            .await
            .expect("full");
        create_test_file(&db, "f1").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move");
        assert_eq!(
            db.delete_empty_directories(vec![dir.id])
                .await
                .expect("del"),
            0
        );
    }

    // The active filter drops trashed rows, so a directory holding only trashed
    // files counts as empty.
    #[tokio::test]
    async fn delete_empty_directories_deletes_when_all_files_trashed() {
        let db = test_db().await;
        let dir = db
            .insert_directory("trashed".to_string(), None)
            .await
            .expect("trashed");
        create_test_file(&db, "f1").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move");
        db.transaction(|c| {
            c.execute(
                "UPDATE files SET trashedAt = ? WHERE id = ?",
                params![Utc::now().timestamp_millis(), "f1"],
            )?;
            Ok(())
        })
        .await
        .expect("trash");
        assert_eq!(
            db.delete_empty_directories(vec![dir.id])
                .await
                .expect("del"),
            1
        );
    }

    // The active filter requires `current = 1`, so a non-current version leaves the
    // directory empty.
    #[tokio::test]
    async fn delete_empty_directories_ignores_non_current_versions() {
        let db = test_db().await;
        let dir = db
            .insert_directory("versioned".to_string(), None)
            .await
            .expect("versioned");
        create_test_file(&db, "f1").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move");
        db.transaction(|c| {
            c.execute("UPDATE files SET current = 0 WHERE id = ?", params!["f1"])?;
            Ok(())
        })
        .await
        .expect("mark non-current");
        assert_eq!(
            db.delete_empty_directories(vec![dir.id])
                .await
                .expect("del"),
            1
        );
    }

    #[tokio::test]
    async fn delete_empty_directories_keeps_directory_with_subdirectories() {
        let db = test_db().await;
        let parent = db
            .insert_directory("hasChild".to_string(), None)
            .await
            .expect("hasChild");
        db.insert_directory("sub".to_string(), Some("hasChild".to_string()))
            .await
            .expect("sub");
        assert_eq!(
            db.delete_empty_directories(vec![parent.id])
                .await
                .expect("del"),
            0
        );
    }

    #[tokio::test]
    async fn delete_empty_directories_walks_up_and_deletes_empty_parent() {
        let db = test_db().await;
        db.insert_directory("outer".to_string(), None)
            .await
            .expect("outer");
        let child = db
            .insert_directory("inner".to_string(), Some("outer".to_string()))
            .await
            .expect("inner");
        assert_eq!(
            db.delete_empty_directories(vec![child.id])
                .await
                .expect("del"),
            2
        );
        assert!(list_all_paths(&db).await.is_empty());
    }

    #[tokio::test]
    async fn delete_empty_directories_stops_at_parent_with_files() {
        let db = test_db().await;
        let parent = db
            .insert_directory("parent".to_string(), None)
            .await
            .expect("parent");
        let child = db
            .insert_directory("child".to_string(), Some("parent".to_string()))
            .await
            .expect("child");
        create_test_file(&db, "f1").await;
        db.move_file_to_directory("f1".to_string(), Some(parent.id.clone()))
            .await
            .expect("move");
        assert_eq!(
            db.delete_empty_directories(vec![child.id])
                .await
                .expect("del"),
            1
        );
        assert_eq!(list_all_paths(&db).await, vec!["parent"]);
    }

    #[tokio::test]
    async fn delete_empty_directories_deletes_only_empty_in_mixed_input() {
        let db = test_db().await;
        let mut ids: Vec<String> = Vec::new();
        for i in 0..50 {
            let dir = db
                .insert_directory(format!("mixed-{i}").clone(), None)
                .await
                .expect("mixed");
            ids.push(dir.id.clone());
            if i % 2 == 0 {
                let file_id = format!("mixed-f-{i}");
                create_test_file(&db, &file_id).await;
                db.move_file_to_directory(file_id.clone(), Some(dir.id.clone()))
                    .await
                    .expect("move");
            }
        }
        assert_eq!(
            db.delete_empty_directories(ids.clone()).await.expect("del"),
            25
        );
        assert_eq!(list_all_paths(&db).await.len(), 25);
    }

    #[tokio::test]
    async fn delete_empty_directories_ignores_non_existent_ids() {
        let db = test_db().await;
        let dir = db
            .insert_directory("real".to_string(), None)
            .await
            .expect("real");
        let deleted = db
            .delete_empty_directories(vec![dir.id, "bogus-1".into(), "bogus-2".into()])
            .await
            .expect("del");
        assert_eq!(deleted, 1);
    }

    #[tokio::test]
    async fn delete_empty_directories_empty_is_noop() {
        let db = test_db().await;
        assert_eq!(db.delete_empty_directories(vec![]).await.expect("del"), 0);
    }

    #[tokio::test]
    async fn move_directory_moves_under_new_parent_with_descendants() {
        let db = test_db().await;
        db.insert_directory("Work".to_string(), None)
            .await
            .expect("work");
        let reports = db
            .insert_directory("Reports".to_string(), Some("Work".to_string()))
            .await
            .expect("reports");
        db.insert_directory("Q1".to_string(), Some("Work/Reports".to_string()))
            .await
            .expect("q1");
        db.insert_directory("Archive".to_string(), None)
            .await
            .expect("archive");

        db.move_directory(reports.id.clone(), Some("Archive".to_string()))
            .await
            .expect("move");
        let paths = list_all_paths(&db).await;
        assert!(paths.contains(&"Archive/Reports".to_string()));
        assert!(paths.contains(&"Archive/Reports/Q1".to_string()));
        assert!(!paths.contains(&"Work/Reports".to_string()));
    }

    #[tokio::test]
    async fn move_directory_moves_to_root() {
        let db = test_db().await;
        db.insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        let vacation = db
            .insert_directory("Vacation".to_string(), Some("Photos".to_string()))
            .await
            .expect("vacation");
        db.move_directory(vacation.id.clone(), None)
            .await
            .expect("move");
        let mut paths = list_all_paths(&db).await;
        paths.sort();
        assert_eq!(paths, vec!["Photos", "Vacation"]);
    }

    #[tokio::test]
    async fn move_directory_rejects_move_into_self() {
        let db = test_db().await;
        let photos = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        db.insert_directory("Vacation".to_string(), Some("Photos".to_string()))
            .await
            .expect("vacation");
        assert!(matches!(
            db.move_directory(photos.id.clone(), Some("Photos/Vacation".to_string()))
                .await
                .unwrap_err(),
            DirectoryError::MoveIntoSelf
        ));
    }

    #[tokio::test]
    async fn move_directory_rejects_sibling_name_conflict() {
        let db = test_db().await;
        db.insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        let vacation = db
            .insert_directory("Vacation".to_string(), Some("Photos".to_string()))
            .await
            .expect("nested");
        db.insert_directory("Vacation".to_string(), None)
            .await
            .expect("root vacation");
        assert!(matches!(
            db.move_directory(vacation.id.clone(), None)
                .await
                .unwrap_err(),
            DirectoryError::AlreadyExistsAtDest(_)
        ));
    }

    #[tokio::test]
    async fn move_directory_bumps_updated_at_on_subtree_files() {
        let db = test_db().await;
        db.insert_directory("Work".to_string(), None)
            .await
            .expect("work");
        let reports = db
            .insert_directory("Reports".to_string(), Some("Work".to_string()))
            .await
            .expect("reports");
        let q1 = db
            .insert_directory("Q1".to_string(), Some("Work/Reports".to_string()))
            .await
            .expect("q1");
        db.insert_directory("Archive".to_string(), None)
            .await
            .expect("archive");
        create_test_file(&db, "f1").await;
        create_test_file(&db, "f2").await;
        assign_dir(&db, "f1", &reports.id).await;
        assign_dir(&db, "f2", &q1.id).await;

        db.move_directory(reports.id.clone(), Some("Archive".to_string()))
            .await
            .expect("move");
        assert!(updated_at(&db, "f1").await > 1000);
        assert!(updated_at(&db, "f2").await > 1000);
    }

    #[tokio::test]
    async fn natural_sort_order_sorts_directories_numerically() {
        let db = test_db().await;
        for n in ["Folder 10", "Folder 2", "Folder 1", "Folder 20", "Folder 3"] {
            db.insert_directory(n.to_string(), None)
                .await
                .expect("insert");
        }
        let names: Vec<String> = db
            .query_all_directories_with_counts()
            .await
            .expect("all")
            .iter()
            .map(|d| d.directory.path.clone())
            .collect();
        assert_eq!(
            names,
            vec!["Folder 1", "Folder 2", "Folder 3", "Folder 10", "Folder 20"]
        );
    }

    // Moving under a parent path with no directory row must fail, not rebase: the
    // subtree would become unreachable (no root listing shows "Ghost/leaf").
    #[tokio::test]
    async fn move_directory_rejects_nonexistent_destination_parent() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        let err = db
            .move_directory(dir.id.clone(), Some("Ghost".to_string()))
            .await
            .unwrap_err();
        assert!(matches!(err, DirectoryError::NotFound));
        // The path is untouched.
        let after = db
            .query_directory_by_id(dir.id.clone())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(after.path, "Photos");
    }

    // A same-name rename is a no-op: no descendant rewrite, no file bump, no re-push.
    #[tokio::test]
    async fn rename_directory_to_same_name_touches_nothing() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        create_test_file(&db, "f1").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move");
        let before = updated_at(&db, "f1").await;

        let out = db
            .rename_directory(dir.id.clone(), "Photos".to_string())
            .await
            .expect("rename");
        assert_eq!(out.path, "Photos");
        let after = updated_at(&db, "f1").await;
        assert_eq!(after, before, "no-op rename must not bump subtree files");
    }

    // delete_directory_and_trash_files detaches EVERY remaining subtree file before
    // deleting the directory rows: a file trashed before the call must not keep a
    // dangling directoryId (it would appear in no folder and not in unfiled).
    #[tokio::test]
    async fn delete_directory_and_trash_files_detaches_previously_trashed_files() {
        let db = test_db().await;
        let dir = db
            .insert_directory("Photos".to_string(), None)
            .await
            .expect("photos");
        create_test_file(&db, "f1").await;
        db.move_file_to_directory("f1".to_string(), Some(dir.id.clone()))
            .await
            .expect("move");
        db.trash_files_and_thumbnails(vec!["f1".into()])
            .await
            .expect("pre-trash");

        db.delete_directory_and_trash_files(dir.id.clone())
            .await
            .expect("delete");

        let dir_id = directory_id_of(&db, "f1").await;
        assert_eq!(
            dir_id, None,
            "no dangling directoryId after the dirs are gone"
        );
    }

    // The Skip arm of sync_directory_from_metadata: the reassign happens, current is
    // left for the caller's consolidated recalc.
    #[tokio::test]
    async fn sync_directory_from_metadata_skip_moves_without_recalc() {
        let db = test_db().await;
        create_test_file(&db, "f1").await;
        db.sync_directory_from_metadata(
            "f1".to_string(),
            Some("Photos".to_string()),
            CurrentRecalc::Skip,
        )
        .await
        .expect("sync");
        let dir_id = directory_id_of(&db, "f1").await;
        assert!(
            dir_id.is_some(),
            "file reassigned into the created directory"
        );
    }
}
