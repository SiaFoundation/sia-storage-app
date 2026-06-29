//! The tag store: user tags plus the built-in system tags (currently just Favorites), the
//! `file_tags` links joining tags to files, and the metadata-sync reconciliation that keeps a
//! file's links matching its indexer tag list.

use std::collections::HashMap;

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};

use crate::db::DbError;
use crate::db::database::Db;
use crate::db::operations::{filter, local_objects};
use crate::db::sql;
use crate::lib_utils::unique_id::unique_id;

#[derive(Debug, Clone)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub used_at: i64,
    pub system: bool,
}

#[derive(Debug, Clone)]
pub struct TagWithCount {
    pub tag: Tag,
    pub file_count: u64,
}

fn tag_from_db_row(r: &rusqlite::Row) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: r.get("id")?,
        name: r.get("name")?,
        created_at: r.get("createdAt")?,
        used_at: r.get("usedAt")?,
        system: r.get("system")?,
    })
}

#[derive(Debug, thiserror::Error)]
pub enum TagError {
    #[error("Tag name cannot be empty")]
    EmptyName,
    #[error("Tag \"{0}\" already exists")]
    AlreadyExists(String),
    #[error("System tags cannot be renamed")]
    SystemRename,
    #[error("System tags cannot be deleted")]
    SystemDelete,
    #[error(transparent)]
    Db(#[from] DbError),
}

impl From<rusqlite::Error> for TagError {
    fn from(e: rusqlite::Error) -> Self {
        TagError::Db(DbError::from(e))
    }
}

pub(crate) struct SystemTag {
    pub id: &'static str,
    pub name: &'static str,
}

pub(crate) const SYSTEM_TAG_FAVORITES: SystemTag = SystemTag {
    id: "sys:favorites",
    name: "Favorites",
};

/// The built-in tags seeded into every database (currently just Favorites).
pub(crate) const SYSTEM_TAGS: &[SystemTag] = &[SYSTEM_TAG_FAVORITES];

fn require_non_empty(name: String) -> Result<String, TagError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(TagError::EmptyName);
    }
    if trimmed.len() == name.len() {
        Ok(name)
    } else {
        Ok(trimmed.to_string())
    }
}

fn read_tag_by_id(conn: &Connection, tag_id: &str) -> Result<Option<Tag>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, name, createdAt, usedAt, system FROM tags WHERE id = ?",
            params![tag_id],
            tag_from_db_row,
        )
        .optional()?)
}

/// `name` is UNIQUE, so this returns the single row of that name or `None`.
fn read_tag_by_name(conn: &Connection, name: &str) -> Result<Option<Tag>, DbError> {
    Ok(conn
        .query_row(
            "SELECT id, name, createdAt, usedAt, system FROM tags WHERE name = ?",
            params![name],
            tag_from_db_row,
        )
        .optional()?)
}

/// Bump `files.updatedAt` to now and flag every object of those files dirty, so a
/// metadata-affecting change re-pushes them on the next sync-up.
fn touch_files(conn: &Connection, file_ids: &[String]) -> Result<(), DbError> {
    if file_ids.is_empty() {
        return Ok(());
    }
    conn.execute(
        "UPDATE files SET updatedAt = ? WHERE id IN rarray(?)",
        params![Utc::now().timestamp_millis(), sql::id_array(file_ids)],
    )?;
    local_objects::flag_objects_for_files_stmt(conn, file_ids)?;
    Ok(())
}

/// Bump `updatedAt` and flag the objects of every file carrying this tag, so a tag
/// rename/delete re-pushes those files' metadata.
fn touch_files_with_tag(conn: &Connection, tag_id: &str, now: i64) -> Result<(), DbError> {
    conn.execute(
        "UPDATE files SET updatedAt = ? WHERE id IN (SELECT fileId FROM file_tags WHERE tagId = ?)",
        params![now, tag_id],
    )?;
    conn.execute(
        "UPDATE objects SET needsSyncUp = 1 WHERE fileId IN (SELECT fileId FROM file_tags WHERE tagId = ?)",
        params![tag_id],
    )?;
    Ok(())
}

/// Seed every system tag idempotently (`OR IGNORE`), marking each `system = 1` so rename/delete
/// reject it later.
pub(in crate::db) fn ensure_system_tags_stmt(conn: &Connection) -> Result<(), DbError> {
    let now = Utc::now().timestamp_millis();
    let mut stmt = conn.prepare(
        "INSERT OR IGNORE INTO tags (id, name, createdAt, usedAt, system) VALUES (?1, ?2, ?3, ?3, 1)",
    )?;
    for tag in SYSTEM_TAGS {
        stmt.execute(params![tag.id, tag.name, now])?;
    }
    Ok(())
}

/// Return the tag named `name`, creating it if absent, and bump its `usedAt` to now either way.
/// Errors `EmptyName` on a blank name.
pub(in crate::db) fn get_or_create_tag_stmt(
    conn: &Connection,
    name: String,
) -> Result<Tag, TagError> {
    let trimmed = require_non_empty(name)?;
    let now = Utc::now().timestamp_millis();
    // Keyed on the UNIQUE name: insert the tag, or on a name collision bump `usedAt` (leaving
    // `createdAt` and `system` intact). RETURNING hands back the row either way.
    Ok(conn.query_row(
        "INSERT INTO tags (id, name, createdAt, usedAt, system) VALUES (?1, ?2, ?3, ?3, 0)
          ON CONFLICT(name) DO UPDATE SET usedAt = excluded.usedAt
          RETURNING id, name, createdAt, usedAt, system",
        params![unique_id(), trimmed, now],
        tag_from_db_row,
    )?)
}

/// Whether the file carries the Favorites tag.
pub(in crate::db) fn query_is_favorite_stmt(
    conn: &Connection,
    file_id: &str,
) -> Result<bool, DbError> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM file_tags WHERE fileId = ? AND tagId = ?",
            params![file_id, SYSTEM_TAG_FAVORITES.id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

pub(in crate::db) fn query_tags_for_file_stmt(
    conn: &Connection,
    file_id: &str,
) -> Result<Vec<Tag>, DbError> {
    let mut stmt = conn.prepare(
        r"SELECT t.id, t.name, t.createdAt, t.usedAt, t.system
          FROM tags t
          INNER JOIN file_tags ft ON ft.tagId = t.id
          WHERE ft.fileId = ?
          ORDER BY t.name",
    )?;
    let out = stmt
        .query_map(params![file_id], tag_from_db_row)?
        .collect::<rusqlite::Result<Vec<Tag>>>()?;
    Ok(out)
}

/// Get-or-create a tag row for every name, bumping `usedAt` on each. Returns a map from each
/// trimmed name to its tag id, so callers look up on the trimmed tag. Blank / whitespace-only
/// names are skipped and never appear in the result.
fn ensure_tags_by_name<'a, I>(
    conn: &Connection,
    names: I,
) -> Result<HashMap<String, String>, TagError>
where
    I: IntoIterator<Item = &'a str>,
{
    let now = Utc::now().timestamp_millis();
    let mut tags: HashMap<String, String> = HashMap::new();
    let mut stmt = conn.prepare(
        "INSERT INTO tags (id, name, createdAt, usedAt, system) VALUES (?1, ?2, ?3, ?3, 0)
          ON CONFLICT(name) DO UPDATE SET usedAt = excluded.usedAt
          RETURNING id, name, createdAt, usedAt, system",
    )?;
    for raw in names {
        let name = raw.trim();
        if name.is_empty() || tags.contains_key(name) {
            continue;
        }
        let tag = stmt.query_row(params![unique_id(), name, now], tag_from_db_row)?;
        tags.insert(tag.name, tag.id);
    }
    Ok(tags)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagSyncEntry {
    pub file_id: String,
    pub tag_names: Vec<String>,
}

pub(in crate::db) fn sync_tags_from_metadata_stmt(
    conn: &Connection,
    entries: &[TagSyncEntry],
) -> Result<(), TagError> {
    ensure_system_tags_stmt(conn)?;

    let tag_map = ensure_tags_by_name(
        conn,
        entries
            .iter()
            .flat_map(|e| e.tag_names.iter().map(String::as_str)),
    )?;

    let file_ids: Vec<String> = entries.iter().map(|e| e.file_id.clone()).collect();
    conn.execute(
        r"DELETE FROM file_tags WHERE fileId IN rarray(?) AND tagId NOT IN (
            SELECT id FROM tags WHERE system = 1
          )",
        [sql::id_array(&file_ids)],
    )?;

    let mut stmt = conn.prepare("INSERT OR IGNORE INTO file_tags (fileId, tagId) VALUES (?, ?)")?;
    for entry in entries {
        for name in &entry.tag_names {
            if let Some(tag_id) = tag_map.get(name.trim()) {
                stmt.execute(params![entry.file_id, tag_id])?;
            }
        }
    }
    Ok(())
}

impl Db {
    /// Seed the built-in system tags idempotently.
    pub async fn ensure_system_tags(&self) -> Result<(), DbError> {
        self.transaction(move |c| ensure_system_tags_stmt(c)).await
    }

    /// Create a new user tag from a trimmed name. Errors `EmptyName` on a blank name and
    /// `AlreadyExists` when a tag of that name is already present.
    pub async fn insert_tag(&self, name: String) -> Result<Tag, TagError> {
        let trimmed = require_non_empty(name)?;
        self.transaction(move |c| {
            let now = Utc::now().timestamp_millis();
            // The UNIQUE name constraint is the check: a collision hits DO NOTHING and returns no
            // row, which maps to AlreadyExists.
            let created = c
                .query_row(
                    "INSERT INTO tags (id, name, createdAt, usedAt, system) VALUES (?1, ?2, ?3, ?3, 0)
                       ON CONFLICT(name) DO NOTHING
                       RETURNING id, name, createdAt, usedAt, system",
                    params![unique_id(), trimmed, now],
                    tag_from_db_row,
                )
                .optional()?;
            match created {
                Some(tag) => Ok(Ok(tag)),
                None => Ok(Err(TagError::AlreadyExists(trimmed))),
            }
        })
        .await?
    }

    /// Return the tag named `name`, creating it if absent, and bump its `usedAt` to now either
    /// way. Errors `EmptyName` on a blank name.
    pub async fn get_or_create_tag(&self, name: String) -> Result<Tag, TagError> {
        self.transaction(move |c| Ok(get_or_create_tag_stmt(c, name)))
            .await?
    }

    /// Return a file's tags, ordered alphabetically by name.
    pub async fn query_tags_for_file(&self, file_id: String) -> Result<Vec<Tag>, DbError> {
        self.transaction(move |c| query_tags_for_file_stmt(c, &file_id))
            .await
    }

    /// Return a file's tag names (alphabetical), or `None` when it has no tags, the shape the
    /// indexer metadata encoder expects.
    pub async fn query_tag_names_for_file(
        &self,
        file_id: String,
    ) -> Result<Option<Vec<String>>, DbError> {
        let tags = self.query_tags_for_file(file_id).await?;
        if tags.is_empty() {
            Ok(None)
        } else {
            Ok(Some(tags.into_iter().map(|t| t.name).collect()))
        }
    }

    /// List every tag with its live-file count: system tags first, then by name. The count
    /// honors `build_record_filter`, so trashed, superseded, and thumbnail rows linked to a tag
    /// are excluded.
    pub async fn query_all_tags_with_counts(&self) -> Result<Vec<TagWithCount>, DbError> {
        self.transaction(move |c| {
            let active_file =
                filter::build_record_filter("f", filter::BuildRecordFilterOpts::default());
            let q = format!(
                r"SELECT t.id, t.name, t.createdAt, t.usedAt, t.system, COUNT(f.id) AS fileCount
                  FROM tags t
                  LEFT JOIN file_tags ft ON ft.tagId = t.id
                  LEFT JOIN files f ON f.id = ft.fileId AND {active_file}
                  GROUP BY t.id
                  ORDER BY t.system DESC, t.name",
            );
            let mut stmt = c.prepare(&q)?;
            let out = stmt
                .query_map([], |r| {
                    Ok(TagWithCount {
                        tag: tag_from_db_row(r)?,
                        file_count: r.get("fileCount")?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<TagWithCount>>>()?;
            Ok(out)
        })
        .await
    }

    /// Link an existing tag to a file (`OR IGNORE`, so re-linking is a no-op). Unlike
    /// `add_tag_to_file` this neither creates the tag nor bumps `updatedAt`.
    pub async fn insert_file_tag(&self, file_id: String, tag_id: String) -> Result<(), DbError> {
        self.transaction(move |c| {
            c.execute(
                "INSERT OR IGNORE INTO file_tags (fileId, tagId) VALUES (?, ?)",
                params![file_id, tag_id],
            )?;
            Ok(())
        })
        .await
    }

    /// Suggest tags for autocomplete: a blank query returns the most recently used tags;
    /// otherwise a case-insensitive `name LIKE 'query%'` prefix match (with `%_\` escaped),
    /// both ordered by `usedAt DESC` and capped at `limit`.
    pub async fn query_tags_by_prefix(
        &self,
        query: String,
        limit: u32,
    ) -> Result<Vec<Tag>, DbError> {
        self.transaction(move |c| {
            let trimmed = query.trim();
            if trimmed.is_empty() {
                let mut stmt = c.prepare(
                    "SELECT id, name, createdAt, usedAt, system FROM tags ORDER BY usedAt DESC LIMIT ?",
                )?;
                let out = stmt
                    .query_map(params![limit], tag_from_db_row)?
                    .collect::<rusqlite::Result<Vec<Tag>>>()?;
                return Ok(out);
            }
            let pattern = format!("{}%", sql::escape_like_pattern(trimmed));
            // Case-insensitivity comes from LIKE's default ASCII folding (a COLLATE on a LIKE
            // operand is inert in SQLite).
            let mut stmt = c.prepare(
                r"SELECT id, name, createdAt, usedAt, system FROM tags
                  WHERE name LIKE ? ESCAPE '\'
                  ORDER BY usedAt DESC
                  LIMIT ?",
            )?;
            let out = stmt
                .query_map(params![pattern, limit], tag_from_db_row)?
                .collect::<rusqlite::Result<Vec<Tag>>>()?;
            Ok(out)
        })
        .await
    }

    /// Toggle a file's Favorites tag: remove the `file_tags` link if present, else add it (`OR
    /// IGNORE`), then bump the file's `updatedAt` so the change syncs.
    pub async fn toggle_favorite(&self, file_id: String) -> Result<(), DbError> {
        self.transaction(move |c| {
            let tag_id = SYSTEM_TAG_FAVORITES.id;
            if query_is_favorite_stmt(c, &file_id)? {
                c.execute(
                    "DELETE FROM file_tags WHERE fileId = ? AND tagId = ?",
                    params![file_id, tag_id],
                )?;
            } else {
                c.execute(
                    "INSERT OR IGNORE INTO file_tags (fileId, tagId) VALUES (?, ?)",
                    params![file_id, tag_id],
                )?;
            }
            touch_files(c, std::slice::from_ref(&file_id))?;
            Ok(())
        })
        .await
    }

    /// Whether the file carries the Favorites tag.
    pub async fn query_is_favorite(&self, file_id: String) -> Result<bool, DbError> {
        self.transaction(move |c| query_is_favorite_stmt(c, &file_id))
            .await
    }

    /// Rename a user tag and bump `updatedAt` on every file carrying it. Errors `EmptyName` on
    /// a blank name, `SystemRename` for a system tag, and `AlreadyExists` on a name collision.
    /// A missing `tag_id` is a silent no-op.
    pub async fn rename_tag(&self, tag_id: String, name: String) -> Result<(), TagError> {
        let trimmed = require_non_empty(name)?;
        self.transaction(move |c| {
            // Return before the dup-check: renaming a nonexistent id to a colliding name is
            // a silent no-op, not Err(AlreadyExists).
            let Some(tag) = read_tag_by_id(c, &tag_id)? else {
                return Ok(Ok(()));
            };
            if tag.system {
                return Ok(Err(TagError::SystemRename));
            }
            if let Some(dup) = read_tag_by_name(c, &trimmed)?
                && dup.id != tag_id
            {
                return Ok(Err(TagError::AlreadyExists(trimmed)));
            }
            let now = Utc::now().timestamp_millis();
            c.execute(
                "UPDATE tags SET name = ? WHERE id = ?",
                params![trimmed, tag_id],
            )?;
            touch_files_with_tag(c, &tag_id, now)?;
            Ok(Ok(()))
        })
        .await?
    }

    /// Delete a user tag and its `file_tags` links, bumping `updatedAt` and flagging the
    /// objects of every carrier so the removal syncs. Errors `SystemDelete` for a system tag; a
    /// missing `tag_id` is a silent no-op.
    pub async fn delete_tag(&self, tag_id: String) -> Result<(), TagError> {
        self.transaction(move |c| {
            let Some(tag) = read_tag_by_id(c, &tag_id)? else {
                return Ok(Ok(()));
            };
            if tag.system {
                return Ok(Err(TagError::SystemDelete));
            }
            // Flag carriers before deleting the links: the flag reads them through the
            // file_tags subquery.
            touch_files_with_tag(c, &tag_id, Utc::now().timestamp_millis())?;
            c.execute("DELETE FROM file_tags WHERE tagId = ?", params![tag_id])?;
            c.execute("DELETE FROM tags WHERE id = ?", params![tag_id])?;
            Ok(Ok(()))
        })
        .await?
    }

    /// Tag a file by name, creating the tag if needed, and bump its `updatedAt`.
    pub async fn add_tag_to_file(&self, file_id: String, tag_name: String) -> Result<(), TagError> {
        self.add_tag_to_files(vec![file_id], tag_name).await
    }

    /// Tag every file in `file_ids` by name (creating the tag once).
    pub async fn add_tag_to_files(
        &self,
        file_ids: Vec<String>,
        tag_name: String,
    ) -> Result<(), TagError> {
        if file_ids.is_empty() {
            return Ok(());
        }
        self.transaction(move |c| {
            let tag = match get_or_create_tag_stmt(c, tag_name) {
                Ok(t) => t,
                Err(e) => return Ok(Err(e)),
            };
            let mut stmt =
                c.prepare("INSERT OR IGNORE INTO file_tags (fileId, tagId) VALUES (?, ?)")?;
            // Touch only files that gained a NEW link (execute returns rows changed), so re-tagging
            // a file that already has the tag doesn't bump updatedAt and re-flag it for sync-up.
            let mut linked = Vec::new();
            for file_id in &file_ids {
                if stmt.execute(params![file_id, tag.id])? > 0 {
                    linked.push(file_id.clone());
                }
            }
            touch_files(c, &linked)?;
            Ok(Ok(()))
        })
        .await?
    }

    /// Unlink a tag from a file and bump the file's `updatedAt`.
    pub async fn remove_tag_from_file(
        &self,
        file_id: String,
        tag_id: String,
    ) -> Result<(), DbError> {
        self.remove_tag_from_files(vec![file_id], tag_id).await
    }

    /// Unlink a tag from every file in `file_ids` and bump their `updatedAt`.
    pub async fn remove_tag_from_files(
        &self,
        file_ids: Vec<String>,
        tag_id: String,
    ) -> Result<(), DbError> {
        if file_ids.is_empty() {
            return Ok(());
        }
        self.transaction(move |c| {
            // RETURNING gives back the files that actually had the link, so touch only those, not
            // every input.
            let mut stmt = c.prepare(
                "DELETE FROM file_tags WHERE tagId = ? AND fileId IN rarray(?) RETURNING fileId",
            )?;
            let unlinked: Vec<String> = stmt
                .query_map(params![tag_id, sql::id_array(&file_ids)], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<String>>>()?;
            touch_files(c, &unlinked)?;
            Ok(())
        })
        .await
    }

    /// Reconcile one file's `file_tags` to the canonical tag list from indexer metadata. A
    /// `None` tag list is a no-op; blank names in the list are skipped. Existing non-system
    /// links are replaced; system-tag links (Favorites) survive.
    pub async fn sync_tags_from_metadata_single(
        &self,
        file_id: String,
        tag_names: Option<Vec<String>>,
    ) -> Result<(), TagError> {
        let Some(tag_names) = tag_names else {
            return Ok(());
        };
        self.transaction(move |c| {
            ensure_system_tags_stmt(c)?;
            c.execute(
                r"DELETE FROM file_tags WHERE fileId = ? AND tagId NOT IN (
                    SELECT id FROM tags WHERE system = 1
                  )",
                params![file_id],
            )?;
            let tag_map = match ensure_tags_by_name(c, tag_names.iter().map(|s| s.as_str())) {
                Ok(m) => m,
                Err(e) => return Ok(Err(e)),
            };
            let mut stmt =
                c.prepare("INSERT OR IGNORE INTO file_tags (fileId, tagId) VALUES (?, ?)")?;
            for name in &tag_names {
                if let Some(tag_id) = tag_map.get(name.trim()) {
                    stmt.execute(params![file_id, tag_id])?;
                }
            }
            Ok(Ok(()))
        })
        .await?
    }

    /// Reconcile `file_tags` to match the canonical per-file tag list from indexer metadata
    /// (batch). Existing non-system links are replaced; system-tag links (Favorites) survive.
    /// Unlike the single variant, an entry cannot express "no tag list": an empty `tag_names`
    /// wipes the file's non-system links, so callers must omit entries whose metadata carries
    /// no list.
    pub async fn sync_tags_from_metadata(
        &self,
        entries: Vec<TagSyncEntry>,
    ) -> Result<(), TagError> {
        if entries.is_empty() {
            return Ok(());
        }
        self.transaction(move |c| Ok(sync_tags_from_metadata_stmt(c, &entries)))
            .await?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> Db {
        Db::open_in_memory().await.unwrap()
    }

    // open_in_memory runs the migrations, which seed the Favorites system tag; clear it so
    // the CRUD/count tests start from an empty tags table. The seeding itself is covered by
    // the migration-runner tests.
    async fn empty_tags_db() -> Db {
        let db = test_db().await;
        db.transaction(|c| {
            c.execute_batch("DELETE FROM file_tags; DELETE FROM tags;")?;
            Ok(())
        })
        .await
        .unwrap();
        db
    }

    // file_tags has an FK to files(id) and foreign_keys is ON, so every linked file must
    // exist first.
    async fn seed_file(db: &Db, id: &str) {
        let id = id.to_string();
        db.transaction(move |c| {
            c.execute(
                "INSERT INTO files (id, updatedAt, addedAt, name, size, type, createdAt, hash) \
                 VALUES (?, 0, 0, '', 0, '', 0, '')",
                params![id],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    }

    async fn seed_file_state(
        db: &Db,
        id: &str,
        kind: &str,
        current: bool,
        trashed: bool,
        deleted: bool,
    ) {
        let (id, kind) = (id.to_string(), kind.to_string());
        db.transaction(move |c| {
            let trashed_at: Option<i64> = trashed.then_some(1);
            let deleted_at: Option<i64> = deleted.then_some(1);
            c.execute(
                "INSERT INTO files (id, updatedAt, kind, current, trashedAt, deletedAt, addedAt, name, size, type, createdAt, hash) \
                 VALUES (?, 0, ?, ?, ?, ?, 0, '', 0, '', 0, '')",
                params![id, kind, current, trashed_at, deleted_at],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    }

    // Seed a minimal objects row so the carrier-flagging assertions can read needsSyncUp.
    async fn seed_clean_object(db: &Db, file_id: &str, object_id: &str) {
        let (file_id, object_id) = (file_id.to_string(), object_id.to_string());
        db.transaction(move |c| {
            c.execute(
                "INSERT INTO objects (fileId, indexerURL, id, slabs, encryptedDataKey, encryptedMetadataKey, \
                  encryptedMetadata, dataSignature, metadataSignature, createdAt, updatedAt, needsSyncUp) \
                 VALUES (?, 'https://a.com', ?, '', '', '', '', '', '', 0, 0, 0)",
                params![file_id, object_id],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    }

    async fn tag_count(db: &Db) -> i64 {
        db.transaction(|c| Ok(c.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))?))
            .await
            .unwrap()
    }

    async fn file_tag_count(db: &Db) -> i64 {
        db.transaction(|c| Ok(c.query_row("SELECT COUNT(*) FROM file_tags", [], |r| r.get(0))?))
            .await
            .unwrap()
    }

    async fn file_updated_at(db: &Db, id: &str) -> i64 {
        let id = id.to_string();
        db.transaction(move |c| {
            Ok(c.query_row(
                "SELECT updatedAt FROM files WHERE id = ?",
                params![id],
                |r| r.get(0),
            )?)
        })
        .await
        .unwrap()
    }

    async fn needs_sync_up(db: &Db, object_id: &str) -> i64 {
        let object_id = object_id.to_string();
        db.transaction(move |c| {
            Ok(c.query_row(
                "SELECT needsSyncUp FROM objects WHERE id = ?",
                params![object_id],
                |r| r.get(0),
            )?)
        })
        .await
        .unwrap()
    }

    async fn tag_id_by_name(db: &Db, name: &str) -> String {
        let name = name.to_string();
        db.transaction(move |c| {
            Ok(
                c.query_row("SELECT id FROM tags WHERE name = ?", params![name], |r| {
                    r.get(0)
                })?,
            )
        })
        .await
        .unwrap()
    }

    async fn tag_name_by_id(db: &Db, id: &str) -> String {
        let id = id.to_string();
        db.transaction(move |c| {
            Ok(
                c.query_row("SELECT name FROM tags WHERE id = ?", params![id], |r| {
                    r.get(0)
                })?,
            )
        })
        .await
        .unwrap()
    }

    async fn link_count(db: &Db, file_id: &str, tag_id: &str) -> i64 {
        let (file_id, tag_id) = (file_id.to_string(), tag_id.to_string());
        db.transaction(move |c| {
            Ok(c.query_row(
                "SELECT COUNT(*) FROM file_tags WHERE fileId = ? AND tagId = ?",
                params![file_id, tag_id],
                |r| r.get(0),
            )?)
        })
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn duplicate_name_conflicts_on_insert_and_rename() {
        let db = empty_tags_db().await;
        db.insert_tag("Travel".to_string()).await.unwrap();
        assert!(matches!(
            db.insert_tag("Travel".to_string()).await,
            Err(TagError::AlreadyExists(_))
        ));
        let other = db.insert_tag("Work".to_string()).await.unwrap();
        assert!(matches!(
            db.rename_tag(other.id.clone(), "Travel".to_string()).await,
            Err(TagError::AlreadyExists(_))
        ));
        // Renaming a tag to its own current name is allowed (the dup.id == tag_id guard).
        db.rename_tag(other.id.clone(), "Work".to_string())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn delete_tag_removes_tag_and_its_file_tags() {
        let db = empty_tags_db().await;
        seed_file(&db, "f1").await;
        let tag = db.insert_tag("Travel".to_string()).await.unwrap();
        db.insert_file_tag("f1".to_string(), tag.id.clone())
            .await
            .unwrap();

        db.delete_tag(tag.id.clone()).await.unwrap();
        assert_eq!(tag_count(&db).await, 0);
        assert_eq!(file_tag_count(&db).await, 0);
    }

    #[tokio::test]
    async fn add_tag_to_file_creates_tag_links_it_and_bumps_file() {
        let db = empty_tags_db().await;
        seed_file(&db, "f1").await;
        db.add_tag_to_file("f1".to_string(), "Travel".to_string())
            .await
            .unwrap();
        assert_eq!(tag_count(&db).await, 1);
        assert_eq!(file_tag_count(&db).await, 1);
        assert!(
            file_updated_at(&db, "f1").await > 0,
            "updatedAt should be bumped"
        );
    }

    #[tokio::test]
    async fn add_tag_to_file_re_add_leaves_the_file_untouched() {
        let db = empty_tags_db().await;
        seed_file(&db, "f1").await;
        db.add_tag_to_file("f1".to_string(), "Travel".to_string())
            .await
            .unwrap();
        // Park updatedAt at a sentinel: re-adding a tag the file already carries inserts nothing,
        // so a spurious touch would overwrite the sentinel with the current clock.
        db.transaction(|c| {
            c.execute("UPDATE files SET updatedAt = 999 WHERE id = 'f1'", [])?;
            Ok(())
        })
        .await
        .unwrap();

        db.add_tag_to_file("f1".to_string(), "Travel".to_string())
            .await
            .unwrap();

        assert_eq!(file_updated_at(&db, "f1").await, 999);
        assert_eq!(file_tag_count(&db).await, 1);
    }

    #[tokio::test]
    async fn add_tag_to_files_empty_is_noop() {
        let db = empty_tags_db().await;
        db.add_tag_to_files(vec![], "Trip".to_string())
            .await
            .unwrap();
        assert_eq!(tag_count(&db).await, 0);
    }

    #[tokio::test]
    async fn add_tag_to_files_links_the_tag_to_each_file() {
        // Asserts per-file membership, so a batch insert that linked one file twice or
        // skipped one fails rather than passing on a coincidental total.
        let db = empty_tags_db().await;
        for f in ["f1", "f2", "f3"] {
            seed_file(&db, f).await;
        }
        db.add_tag_to_files(
            vec!["f1".into(), "f2".into(), "f3".into()],
            "Trip".to_string(),
        )
        .await
        .unwrap();

        let tag_id = tag_id_by_name(&db, "Trip").await;
        for f in ["f1", "f2", "f3"] {
            assert_eq!(
                link_count(&db, f, &tag_id).await,
                1,
                "file {f} should carry the Trip tag exactly once"
            );
        }
        assert_eq!(file_tag_count(&db).await, 3);
    }

    #[tokio::test]
    async fn remove_tag_from_file_deletes_link() {
        let db = empty_tags_db().await;
        seed_file(&db, "f1").await;
        let tag = db.insert_tag("Travel".to_string()).await.unwrap();
        db.insert_file_tag("f1".to_string(), tag.id.clone())
            .await
            .unwrap();
        db.remove_tag_from_file("f1".to_string(), tag.id.clone())
            .await
            .unwrap();
        assert_eq!(file_tag_count(&db).await, 0);
    }

    #[tokio::test]
    async fn remove_tag_from_files_deletes_links() {
        let db = empty_tags_db().await;
        seed_file(&db, "f1").await;
        seed_file(&db, "f2").await;
        let tag = db.insert_tag("Trip".to_string()).await.unwrap();
        db.insert_file_tag("f1".to_string(), tag.id.clone())
            .await
            .unwrap();
        db.insert_file_tag("f2".to_string(), tag.id.clone())
            .await
            .unwrap();
        db.remove_tag_from_files(vec!["f1".into(), "f2".into()], tag.id.clone())
            .await
            .unwrap();
        assert_eq!(file_tag_count(&db).await, 0);
    }

    #[tokio::test]
    async fn remove_tag_from_files_empty_is_noop() {
        let db = empty_tags_db().await;
        db.remove_tag_from_files(vec![], "any".to_string())
            .await
            .unwrap();
        assert_eq!(file_tag_count(&db).await, 0);
    }

    #[tokio::test]
    async fn sync_tags_from_metadata_empty_is_noop() {
        let db = empty_tags_db().await;
        db.sync_tags_from_metadata(vec![]).await.unwrap();
        assert_eq!(tag_count(&db).await, 0);
        assert_eq!(file_tag_count(&db).await, 0);
    }

    #[tokio::test]
    async fn sync_tags_from_metadata_reconciles_to_canonical_set() {
        // A pre-existing non-system link is dropped and the canonical names are added,
        // creating any missing tags. The Favorites link survives (system tags are kept).
        let db = empty_tags_db().await;
        db.ensure_system_tags().await.unwrap();
        seed_file(&db, "f1").await;
        let stale = db.insert_tag("Stale".to_string()).await.unwrap();
        db.insert_file_tag("f1".to_string(), stale.id.clone())
            .await
            .unwrap();
        db.insert_file_tag("f1".to_string(), SYSTEM_TAG_FAVORITES.id.to_string())
            .await
            .unwrap();

        db.sync_tags_from_metadata(vec![TagSyncEntry {
            file_id: "f1".into(),
            tag_names: vec!["Alpha".into(), "Bravo".into()],
        }])
        .await
        .unwrap();

        let mut names: Vec<String> = db
            .query_tags_for_file("f1".to_string())
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        names.sort();
        // Favorites stays (system), Stale is gone, Alpha/Bravo are added.
        assert_eq!(names, ["Alpha", "Bravo", "Favorites"]);
    }

    #[tokio::test]
    async fn rename_tag_nonexistent_id_is_noop() {
        // The missing-tag early-return runs before the dup-check, so renaming an absent id
        // to a colliding name is Ok(()), not Err(AlreadyExists), and leaves the existing
        // tag untouched.
        let db = empty_tags_db().await;
        let existing = db.insert_tag("Travel".to_string()).await.unwrap();
        db.rename_tag("does-not-exist".to_string(), "Travel".to_string())
            .await
            .unwrap();

        assert_eq!(tag_name_by_id(&db, &existing.id).await, "Travel");
        assert_eq!(tag_count(&db).await, 1);
    }

    #[tokio::test]
    async fn system_tags_cannot_be_renamed_or_deleted() {
        // Use test_db (not empty_tags_db) so the seeded Favorites system tag is present;
        // the rename/delete guards must reject it.
        let db = test_db().await;
        assert!(matches!(
            db.rename_tag(SYSTEM_TAG_FAVORITES.id.to_string(), "whatever".to_string())
                .await,
            Err(TagError::SystemRename)
        ));
        assert!(matches!(
            db.delete_tag(SYSTEM_TAG_FAVORITES.id.to_string()).await,
            Err(TagError::SystemDelete)
        ));
    }

    #[tokio::test]
    async fn get_or_create_tag_rejects_blank_name() {
        let db = empty_tags_db().await;
        for blank in ["", "  "] {
            assert!(matches!(
                db.get_or_create_tag(blank.to_string()).await,
                Err(TagError::EmptyName)
            ));
        }
        assert_eq!(tag_count(&db).await, 0);
    }

    #[tokio::test]
    async fn get_or_create_tag_existing_bumps_used_at_and_keeps_the_rest() {
        // The ON CONFLICT DO UPDATE branch: a second call for an existing name returns the same
        // row with usedAt advanced, leaving createdAt and system untouched (no new row).
        let db = empty_tags_db().await;
        let created = db.insert_tag("Travel".to_string()).await.unwrap();
        db.transaction(|c| {
            c.execute(
                "UPDATE tags SET createdAt = 100, usedAt = 100 WHERE name = 'Travel'",
                [],
            )?;
            Ok(())
        })
        .await
        .unwrap();

        let again = db.get_or_create_tag("Travel".to_string()).await.unwrap();

        assert_eq!(again.id, created.id);
        assert_eq!(tag_count(&db).await, 1);
        assert_eq!(again.created_at, 100, "createdAt is preserved");
        assert!(again.used_at > 100, "usedAt is bumped");
        assert!(!again.system);
    }

    #[tokio::test]
    async fn query_tags_for_file_returns_tags_ordered_by_name() {
        // Insert Bravo before Alpha; the result must be alphabetical, asserting the
        // ORDER BY t.name clause.
        let db = empty_tags_db().await;
        seed_file(&db, "f1").await;
        let bravo = db.insert_tag("Bravo".to_string()).await.unwrap();
        let alpha = db.insert_tag("Alpha".to_string()).await.unwrap();
        db.insert_file_tag("f1".to_string(), bravo.id.clone())
            .await
            .unwrap();
        db.insert_file_tag("f1".to_string(), alpha.id.clone())
            .await
            .unwrap();

        let names: Vec<String> = db
            .query_tags_for_file("f1".to_string())
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert_eq!(names, ["Alpha", "Bravo"]);
    }

    #[tokio::test]
    async fn query_tags_by_prefix_filters_and_orders() {
        // Blank query returns most-recently-used first; a prefix query case-insensitively
        // matches names starting with it (and the `%` wildcard in input is escaped, not
        // treated as a wildcard).
        let db = empty_tags_db().await;
        let now = Utc::now().timestamp_millis();
        db.transaction(move |c| {
            for (name, used) in [("Apple", now), ("Apricot", now + 1), ("Banana", now + 2)] {
                c.execute(
                    "INSERT INTO tags (id, name, createdAt, usedAt, system) VALUES (?, ?, 0, ?, 0)",
                    params![unique_id(), name, used],
                )?;
            }
            Ok(())
        })
        .await
        .unwrap();

        let recent: Vec<String> = db
            .query_tags_by_prefix("  ".to_string(), 10)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert_eq!(recent, ["Banana", "Apricot", "Apple"]);

        let ap: Vec<String> = db
            .query_tags_by_prefix("ap".to_string(), 10)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        // usedAt DESC within the prefix match: Apricot before Apple.
        assert_eq!(ap, ["Apricot", "Apple"]);
    }

    #[tokio::test]
    async fn toggle_favorite_adds_then_removes_and_bumps_file() {
        let db = empty_tags_db().await;
        db.ensure_system_tags().await.unwrap();
        seed_file(&db, "f1").await;

        db.toggle_favorite("f1".to_string()).await.unwrap();
        assert!(db.query_is_favorite("f1".to_string()).await.unwrap());
        assert!(
            file_updated_at(&db, "f1").await > 0,
            "updatedAt should be bumped"
        );

        db.toggle_favorite("f1".to_string()).await.unwrap();
        assert!(!db.query_is_favorite("f1".to_string()).await.unwrap());
    }

    #[tokio::test]
    async fn query_all_tags_with_counts_excludes_trashed_and_non_current_files() {
        // One live file, one trashed, one superseded (current=0), one thumb, all linked to
        // the same tag. Only the live file counts.
        let db = empty_tags_db().await;
        seed_file_state(&db, "live", "file", true, false, false).await;
        seed_file_state(&db, "trashed", "file", true, true, false).await;
        seed_file_state(&db, "old", "file", false, false, false).await;
        seed_file_state(&db, "thumb", "thumb", true, false, false).await;

        let tag = db.insert_tag("Trip".to_string()).await.unwrap();
        for f in ["live", "trashed", "old", "thumb"] {
            db.insert_file_tag(f.to_string(), tag.id.clone())
                .await
                .unwrap();
        }

        let counts = db.query_all_tags_with_counts().await.unwrap();
        let trip = counts.iter().find(|c| c.tag.name == "Trip").unwrap();
        assert_eq!(trip.file_count, 1);
    }

    #[tokio::test]
    async fn query_all_tags_with_counts_counts_live_and_keeps_unused_at_zero() {
        // A tag with two live files counts both; the LEFT JOIN keeps a tag with zero
        // matching files at count 0 rather than dropping it.
        let db = empty_tags_db().await;
        seed_file_state(&db, "a", "file", true, false, false).await;
        seed_file_state(&db, "b", "file", true, false, false).await;
        let used = db.insert_tag("Used".to_string()).await.unwrap();
        db.insert_tag("Unused".to_string()).await.unwrap();
        db.insert_file_tag("a".to_string(), used.id.clone())
            .await
            .unwrap();
        db.insert_file_tag("b".to_string(), used.id.clone())
            .await
            .unwrap();

        let counts = db.query_all_tags_with_counts().await.unwrap();
        assert_eq!(
            counts
                .iter()
                .find(|c| c.tag.name == "Used")
                .unwrap()
                .file_count,
            2
        );
        assert_eq!(
            counts
                .iter()
                .find(|c| c.tag.name == "Unused")
                .unwrap()
                .file_count,
            0
        );
    }

    #[tokio::test]
    async fn rename_tag_renames_and_touches_every_carrier() {
        let db = empty_tags_db().await;
        seed_file(&db, "f1").await;
        seed_clean_object(&db, "f1", "o1").await;
        let tag = db.insert_tag("Travel".to_string()).await.unwrap();
        db.insert_file_tag("f1".to_string(), tag.id.clone())
            .await
            .unwrap();

        db.rename_tag(tag.id.clone(), "Trips".to_string())
            .await
            .unwrap();

        assert_eq!(tag_name_by_id(&db, &tag.id).await, "Trips");
        // The carrier's edit clock bumps and its object is flagged, so the rename syncs.
        assert!(file_updated_at(&db, "f1").await > 0);
        assert_eq!(needs_sync_up(&db, "o1").await, 1);
    }

    #[tokio::test]
    async fn delete_tag_missing_id_is_noop_and_carriers_are_touched_on_real_delete() {
        let db = empty_tags_db().await;
        seed_file(&db, "f1").await;
        seed_clean_object(&db, "f1", "o1").await;
        db.delete_tag("no-such-tag".to_string()).await.unwrap();
        assert_eq!(
            needs_sync_up(&db, "o1").await,
            0,
            "missing id touches nothing"
        );

        let tag = db.insert_tag("Travel".to_string()).await.unwrap();
        db.insert_file_tag("f1".to_string(), tag.id.clone())
            .await
            .unwrap();
        db.delete_tag(tag.id.clone()).await.unwrap();
        assert!(file_updated_at(&db, "f1").await > 0);
        assert_eq!(needs_sync_up(&db, "o1").await, 1);
    }

    #[tokio::test]
    async fn query_tag_names_for_file_returns_sorted_names_or_none() {
        let db = empty_tags_db().await;
        seed_file(&db, "f1").await;
        assert_eq!(
            db.query_tag_names_for_file("f1".to_string()).await.unwrap(),
            None
        );

        db.add_tag_to_file("f1".to_string(), "zeta".to_string())
            .await
            .unwrap();
        db.add_tag_to_file("f1".to_string(), "alpha".to_string())
            .await
            .unwrap();
        assert_eq!(
            db.query_tag_names_for_file("f1".to_string()).await.unwrap(),
            Some(vec!["alpha".to_string(), "zeta".to_string()])
        );
    }

    // The ESCAPE wiring on the prefix query: a literal % in a tag name must match itself,
    // not act as a wildcard admitting other names.
    #[tokio::test]
    async fn query_tags_by_prefix_treats_percent_in_query_literally() {
        let db = empty_tags_db().await;
        db.insert_tag("50% off".to_string()).await.unwrap();
        db.insert_tag("50x off".to_string()).await.unwrap();

        let hits = db
            .query_tags_by_prefix("50%".to_string(), 10)
            .await
            .unwrap();
        let names: Vec<String> = hits.iter().map(|t| t.name.clone()).collect();
        assert_eq!(names, vec!["50% off".to_string()]);
    }

    #[tokio::test]
    async fn sync_tags_from_metadata_single_replaces_links_and_preserves_favorites() {
        let db = test_db().await;
        seed_file(&db, "f1").await;
        db.add_tag_to_file("f1".to_string(), "old".to_string())
            .await
            .unwrap();
        db.insert_file_tag("f1".to_string(), SYSTEM_TAG_FAVORITES.id.to_string())
            .await
            .unwrap();

        db.sync_tags_from_metadata_single(
            "f1".to_string(),
            Some(vec!["new".to_string(), "  ".to_string()]),
        )
        .await
        .unwrap();

        let names = db
            .query_tag_names_for_file("f1".to_string())
            .await
            .unwrap()
            .unwrap();
        // "old" replaced, favorite link survives, the blank name is skipped.
        assert_eq!(names, vec!["Favorites".to_string(), "new".to_string()]);

        // A None tag list leaves links untouched.
        db.sync_tags_from_metadata_single("f1".to_string(), None)
            .await
            .unwrap();
        assert_eq!(
            db.query_tag_names_for_file("f1".to_string())
                .await
                .unwrap()
                .unwrap()
                .len(),
            2
        );
    }

    #[tokio::test]
    async fn sync_tags_from_metadata_skips_blank_names() {
        let db = test_db().await;
        seed_file(&db, "f1").await;
        db.sync_tags_from_metadata(vec![TagSyncEntry {
            file_id: "f1".into(),
            tag_names: vec![" Alpha ".into(), "".into(), "   ".into()],
        }])
        .await
        .unwrap();
        assert_eq!(
            db.query_tag_names_for_file("f1".to_string()).await.unwrap(),
            Some(vec!["Alpha".to_string()])
        );
    }
}
