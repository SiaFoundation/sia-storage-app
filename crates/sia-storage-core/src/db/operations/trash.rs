//! The trash lifecycle: trash and restore flip `trashedAt` on a file and its thumbnails,
//! tombstoning stamps the permanent `deletedAt` marker, and the auto-purge loop tombstones
//! trash older than the configured age in 500-row batches. Every mutation flags the affected
//! objects for sync-up and recalculates version currency.

use chrono::Utc;
use rusqlite::{Connection, params};

use crate::config::trash_auto_purge_age;
use crate::db::DbError;
use crate::db::database::Db;
use crate::db::operations::files::{
    query_file_versions_stmt, recalculate_current_for_file_ids_stmt,
};
use crate::db::operations::local_objects;
use crate::db::sql;

/// Which objects to mark needsSyncUp (queue for push) after the file/thumbnail write.
enum FlagMode {
    /// Only the files' own objects. Trash and restore use this: other devices derive a
    /// thumbnail's trash state from its parent, so pushing thumbnail metadata would just
    /// multiply sync traffic for data nobody reads.
    ParentFilesOnly,
    /// The files' objects and their thumbnails' objects. Tombstone uses this: the indexer
    /// holds a separate object per thumbnail, so deleting only the parent would leave the
    /// thumbnail objects orphaned on the indexer.
    ParentAndThumbnails,
}

/// Apply `set_clause` to both a file row (`WHERE id IN`) and its thumbnails
/// (`WHERE thumbForId IN`), flag the affected objects dirty per `flag_mode`, then
/// recalculate which version is current.
///
/// `set_clause` references the timestamp as the numbered param `?1`; the id list
/// binds as `?2`, shared by both UPDATEs. `where_extra` appends a guard to both
/// WHERE clauses (or is empty).
fn apply_to_files_and_thumbs(
    conn: &Connection,
    file_ids: &[String],
    set_clause: &str,
    where_extra: &str,
    now: i64,
    flag_mode: FlagMode,
) -> Result<(), DbError> {
    if file_ids.is_empty() {
        return Ok(());
    }
    conn.execute(
        &format!("UPDATE files SET {set_clause} WHERE id IN rarray(?2){where_extra}"),
        params![now, sql::id_array(file_ids)],
    )?;
    conn.execute(
        &format!("UPDATE files SET {set_clause} WHERE thumbForId IN rarray(?2){where_extra}"),
        params![now, sql::id_array(file_ids)],
    )?;
    match flag_mode {
        FlagMode::ParentFilesOnly => local_objects::flag_objects_for_files_stmt(conn, file_ids)?,
        FlagMode::ParentAndThumbnails => {
            flag_objects_for_tombstoned_files_and_thumbnails(conn, file_ids)?
        }
    }
    recalculate_current_for_file_ids_stmt(conn, file_ids)?;
    Ok(())
}

/// Flag the objects of these files and their thumbnails so sync-up deletes both
/// remotely. Thumbnail ids are not in hand, so reach them via thumbForId.
fn flag_objects_for_tombstoned_files_and_thumbnails(
    conn: &Connection,
    file_ids: &[String],
) -> Result<(), DbError> {
    local_objects::flag_objects_for_files_stmt(conn, file_ids)?;
    conn.execute(
        r"UPDATE objects SET needsSyncUp = 1
          WHERE fileId IN (SELECT id FROM files WHERE thumbForId IN rarray(?))",
        [sql::id_array(file_ids)],
    )?;
    Ok(())
}

/// Per-batch cleanup hook for [`Db::auto_purge_old_trashed_files`], invoked
/// after each batch is tombstoned so callers can clean on-disk files, fsMeta, and
/// upload state.
pub type PurgeBatchHook<'a> = &'a dyn Fn(&[String]) -> Result<(), DbError>;

impl Db {
    /// Move files and their thumbnails to trash. Reversible: sets `trashedAt` only,
    /// `deletedAt` is untouched.
    pub async fn trash_files_and_thumbnails(&self, file_ids: Vec<String>) -> Result<(), DbError> {
        self.transaction(move |c| trash_files_and_thumbnails_stmt(c, &file_ids))
            .await
    }

    /// Take files and their thumbnails out of trash (clears `trashedAt`). Never
    /// un-deletes: a tombstoned row stays tombstoned.
    pub async fn restore_files_and_thumbnails(&self, file_ids: Vec<String>) -> Result<(), DbError> {
        self.transaction(move |c| {
            apply_to_files_and_thumbs(
                c,
                &file_ids,
                "trashedAt = NULL, updatedAt = ?1",
                "",
                Utc::now().timestamp_millis(),
                FlagMode::ParentFilesOnly,
            )
        })
        .await
    }

    /// Permanently delete files and their thumbnails: stamps `deletedAt` and flags their
    /// objects so sync-up removes them from the indexer. Backfills `trashedAt` (COALESCE)
    /// so a tombstoned row always reads as trashed. Rows already tombstoned keep their
    /// timestamps (`deletedAt IS NULL` guard), but flagging reruns so a failed remote
    /// delete retries.
    pub async fn tombstone_files_and_thumbnails(
        &self,
        file_ids: Vec<String>,
    ) -> Result<(), DbError> {
        self.transaction(move |c| tombstone_files_and_thumbnails_stmt(c, &file_ids))
            .await
    }

    /// Tombstone every file trashed longer than `trash_auto_purge_age`, in 500-row
    /// batches. `on_batch` runs between transactions after each batch commits, the seam
    /// where the app deletes that batch's cached files, thumbnails, and upload state
    /// (disk cleanup is the app layer's job, so it arrives as a callback and stays off
    /// the blocking DB thread); `None` leaves stray disk state to the app's lazy cleanup.
    ///
    /// The loop re-selects a LIMIT-500 batch each pass and breaks only when a batch
    /// comes back empty: tombstoning sets deletedAt, so the `deletedAt IS NULL` filter
    /// drops processed rows from the next select. A partial final batch costs one extra
    /// zero-row select.
    pub async fn auto_purge_old_trashed_files(
        &self,
        on_batch: Option<PurgeBatchHook<'_>>,
    ) -> Result<u64, DbError> {
        let cutoff = Utc::now().timestamp_millis() - trash_auto_purge_age();
        let mut total: u64 = 0;
        loop {
            let ids: Vec<String> = self
                .transaction(move |c| {
                    let mut stmt = c.prepare(
                        "SELECT id FROM files WHERE trashedAt IS NOT NULL AND trashedAt < ? AND deletedAt IS NULL AND kind = 'file' LIMIT 500",
                    )?;
                    let ids: Vec<String> = stmt
                        .query_map(params![cutoff], |r| r.get(0))?
                        .collect::<rusqlite::Result<Vec<String>>>()?;
                    if !ids.is_empty() {
                        tombstone_files_and_thumbnails_stmt(c, &ids)?;
                    }
                    Ok::<_, DbError>(ids)
                })
                .await?;
            if ids.is_empty() {
                break;
            }
            total += ids.len() as u64;
            if let Some(hook) = on_batch {
                hook(&ids)?;
            }
        }
        Ok(total)
    }

    /// Trash every version in the (name, directoryId) stack; returns the trashed ids.
    pub async fn trash_all_file_versions(
        &self,
        name: String,
        directory_id: Option<String>,
    ) -> Result<Vec<String>, DbError> {
        self.transaction(move |c| {
            let versions = query_file_versions_stmt(c, &name, directory_id.as_deref())?;
            if versions.is_empty() {
                return Ok(Vec::new());
            }
            let ids: Vec<String> = versions.into_iter().map(|v| v.id).collect();
            trash_files_and_thumbnails_stmt(c, &ids)?;
            Ok(ids)
        })
        .await
    }
}

pub(in crate::db) fn trash_files_and_thumbnails_stmt(
    conn: &Connection,
    file_ids: &[String],
) -> Result<(), DbError> {
    apply_to_files_and_thumbs(
        conn,
        file_ids,
        "trashedAt = ?1, updatedAt = ?1",
        "",
        Utc::now().timestamp_millis(),
        FlagMode::ParentFilesOnly,
    )
}

pub(in crate::db) fn tombstone_files_and_thumbnails_stmt(
    conn: &Connection,
    file_ids: &[String],
) -> Result<(), DbError> {
    apply_to_files_and_thumbs(
        conn,
        file_ids,
        "deletedAt = ?1, trashedAt = COALESCE(trashedAt, ?1), updatedAt = ?1",
        " AND deletedAt IS NULL",
        Utc::now().timestamp_millis(),
        FlagMode::ParentAndThumbnails,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::operations::files::InsertFileOptions;
    use crate::types::files::{FileKind, FileRecordRow, ThumbSize};
    use crate::types::local_object::LocalObject;
    use chrono::TimeZone;
    use sia_storage::{SealedObject, Signature};

    async fn test_db() -> Db {
        Db::open_in_memory().await.unwrap()
    }

    // A full valid `file`-kind row with deterministic id-derived defaults.
    fn row(id: &str) -> FileRecordRow {
        FileRecordRow {
            id: id.into(),
            name: format!("{id}.jpg"),
            type_: "image/jpeg".into(),
            kind: FileKind::File,
            size: 1024,
            hash: format!("hash-{id}"),
            thumb_for_id: None,
            thumb_size: None,
            trashed_at: None,
            created_at: 1000,
            updated_at: 1000,
            local_id: None,
            added_at: 1000,
            deleted_at: None,
            lost_reason: None,
        }
    }

    // A valid thumbnail row OF `parent` (kind, thumbForId, and thumbSize set together).
    fn thumb_row(id: &str, parent: &str) -> FileRecordRow {
        FileRecordRow {
            kind: FileKind::Thumb,
            thumb_for_id: Some(parent.into()),
            thumb_size: Some(ThumbSize::S64),
            ..row(id)
        }
    }

    async fn seed_file(db: &Db, id: &str, mutate: impl FnOnce(FileRecordRow) -> FileRecordRow) {
        db.insert_file(mutate(row(id)), InsertFileOptions::default())
            .await
            .unwrap();
    }

    // Inserts an object for `file_id` (all on one indexer, ids unique) and clears its
    // dirty flag: upsert lands it needsSyncUp = 1, so start clean to make a later
    // flag observable.
    async fn seed_clean_object(db: &Db, file_id: &str, object_id: &str) {
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
            Ok::<_, DbError>(())
        })
        .await
        .unwrap();
    }

    async fn read_needs_sync_up(db: &Db, object_id: &str) -> i64 {
        let object_id = object_id.to_string();
        db.transaction(move |c| {
            Ok::<_, DbError>(c.query_row(
                "SELECT needsSyncUp FROM objects WHERE id = ?",
                params![object_id],
                |r| r.get(0),
            )?)
        })
        .await
        .unwrap()
    }

    async fn current_flag(db: &Db, id: &str) -> i64 {
        let id = id.to_string();
        db.transaction(move |c| {
            Ok::<_, DbError>(c.query_row(
                "SELECT current FROM files WHERE id = ?",
                params![id],
                |r| r.get(0),
            )?)
        })
        .await
        .unwrap()
    }

    async fn read_trashed_at(db: &Db, id: &str) -> Option<i64> {
        let id = id.to_string();
        db.transaction(move |c| {
            Ok::<_, DbError>(c.query_row(
                "SELECT trashedAt FROM files WHERE id = ?",
                params![id],
                |r| r.get(0),
            )?)
        })
        .await
        .unwrap()
    }

    async fn read_deleted_at(db: &Db, id: &str) -> Option<i64> {
        let id = id.to_string();
        db.transaction(move |c| {
            Ok::<_, DbError>(c.query_row(
                "SELECT deletedAt FROM files WHERE id = ?",
                params![id],
                |r| r.get(0),
            )?)
        })
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn trash_files_and_thumbnails_empty_is_noop() {
        let db = test_db().await;
        seed_file(&db, "f1", |r| r).await;
        // All three batch ops share apply_to_files_and_thumbs's empty guard.
        db.trash_files_and_thumbnails(vec![]).await.unwrap();
        assert!(
            read_trashed_at(&db, "f1").await.is_none(),
            "empty input must touch no rows"
        );
    }

    #[tokio::test]
    async fn trash_sets_trashed_at_and_leaves_deleted_at() {
        let db = test_db().await;
        seed_file(&db, "f1", |r| r).await;
        db.trash_files_and_thumbnails(vec!["f1".into()])
            .await
            .unwrap();
        assert!(read_trashed_at(&db, "f1").await.is_some());
        assert_eq!(read_deleted_at(&db, "f1").await, None);
    }

    #[tokio::test]
    async fn restore_clears_trashed_at() {
        let db = test_db().await;
        seed_file(&db, "f1", |r| r).await;
        db.trash_files_and_thumbnails(vec!["f1".into()])
            .await
            .unwrap();
        db.restore_files_and_thumbnails(vec!["f1".into()])
            .await
            .unwrap();
        assert_eq!(read_trashed_at(&db, "f1").await, None);
    }

    #[tokio::test]
    async fn tombstone_sets_deleted_at_and_backfills_trashed_at() {
        let db = test_db().await;
        seed_file(&db, "f1", |r| r).await;
        db.tombstone_files_and_thumbnails(vec!["f1".into()])
            .await
            .unwrap();
        assert!(read_deleted_at(&db, "f1").await.is_some());
        // trashedAt = COALESCE(trashedAt, now): tombstoning a never-trashed row
        // backfills its trashedAt too.
        assert!(read_trashed_at(&db, "f1").await.is_some());
    }

    #[tokio::test]
    async fn tombstone_preserves_existing_trashed_at() {
        let db = test_db().await;
        // Already trashed at a known time; COALESCE(trashedAt, now) must keep 2000.
        seed_file(&db, "f1", |r| FileRecordRow {
            trashed_at: Some(2000),
            ..r
        })
        .await;
        db.tombstone_files_and_thumbnails(vec!["f1".into()])
            .await
            .unwrap();
        assert_eq!(read_trashed_at(&db, "f1").await, Some(2000));
    }

    #[tokio::test]
    async fn trash_flags_parent_only_tombstone_flags_thumbnail_too() {
        let db = test_db().await;
        seed_file(&db, "f1", |r| r).await;
        seed_file(&db, "t1", |_| thumb_row("t1", "f1")).await;
        seed_clean_object(&db, "f1", "o_parent").await;
        seed_clean_object(&db, "t1", "o_thumb").await;

        // Trash flags ParentFilesOnly: a thumbnail's trashedAt isn't pushed, so
        // flagging its object would push a phantom diff.
        db.trash_files_and_thumbnails(vec!["f1".into()])
            .await
            .unwrap();
        assert_eq!(read_needs_sync_up(&db, "o_parent").await, 1);
        assert_eq!(read_needs_sync_up(&db, "o_thumb").await, 0);

        // Tombstone flags ParentAndThumbnails: the thumbnail object must be deleted
        // remotely too.
        db.tombstone_files_and_thumbnails(vec!["f1".into()])
            .await
            .unwrap();
        assert_eq!(read_needs_sync_up(&db, "o_parent").await, 1);
        assert_eq!(read_needs_sync_up(&db, "o_thumb").await, 1);
    }

    #[tokio::test]
    async fn trash_cascades_to_thumbnails() {
        let db = test_db().await;
        seed_file(&db, "f1", |r| r).await;
        seed_file(&db, "t1", |_| thumb_row("t1", "f1")).await;
        db.trash_files_and_thumbnails(vec!["f1".into()])
            .await
            .unwrap();
        assert!(read_trashed_at(&db, "t1").await.is_some());
    }

    #[tokio::test]
    async fn trash_all_file_versions_trashes_every_version() {
        let db = test_db().await;
        seed_file(&db, "v1", |r| FileRecordRow {
            name: "dup.jpg".into(),
            updated_at: 1000,
            ..r
        })
        .await;
        seed_file(&db, "v2", |r| FileRecordRow {
            name: "dup.jpg".into(),
            updated_at: 2000,
            ..r
        })
        .await;
        let ids = db
            .trash_all_file_versions("dup.jpg".to_string(), None)
            .await
            .unwrap();
        assert_eq!(ids.len(), 2);
        assert!(read_trashed_at(&db, "v1").await.is_some());
        assert!(read_trashed_at(&db, "v2").await.is_some());
    }

    // Trashing the current version hands `current` to the surviving older version, and restore
    // hands it back. The trashed row keeps its stale flag meanwhile (the recalc's clear skips
    // trashed rows); every view filters trashed, and the restore recalc reconverges the group.
    #[tokio::test]
    async fn trash_and_restore_of_the_current_version_reconverge_the_group() {
        let db = test_db().await;
        seed_file(&db, "v1", |r| FileRecordRow {
            name: "dup.jpg".into(),
            updated_at: 1000,
            ..r
        })
        .await;
        seed_file(&db, "v2", |r| FileRecordRow {
            name: "dup.jpg".into(),
            updated_at: 2000,
            ..r
        })
        .await;
        assert_eq!(current_flag(&db, "v2").await, 1);

        db.trash_files_and_thumbnails(vec!["v2".into()])
            .await
            .unwrap();
        assert_eq!(current_flag(&db, "v1").await, 1);
        assert_eq!(
            current_flag(&db, "v2").await,
            1,
            "trashed row keeps its stale flag"
        );

        db.restore_files_and_thumbnails(vec!["v2".into()])
            .await
            .unwrap();
        assert_eq!(current_flag(&db, "v2").await, 1);
        assert_eq!(current_flag(&db, "v1").await, 0);
    }

    #[tokio::test]
    async fn auto_purge_skips_recently_trashed() {
        let db = test_db().await;
        seed_file(&db, "f1", |r| r).await;
        db.trash_files_and_thumbnails(vec!["f1".into()])
            .await
            .unwrap();
        // trashedAt = now sits newer than the (now - 30d) cutoff, so the row is not
        // yet eligible.
        assert_eq!(db.auto_purge_old_trashed_files(None).await.unwrap(), 0);
        assert_eq!(read_deleted_at(&db, "f1").await, None);
    }

    #[tokio::test]
    async fn auto_purge_tombstones_expired_trash_and_invokes_hook() {
        let db = test_db().await;
        // One millisecond past the auto-purge age, below the cutoff regardless of the
        // slight clock advance inside the purge call.
        let old = Utc::now().timestamp_millis() - trash_auto_purge_age() - 1;
        seed_file(&db, "f1", |r| FileRecordRow {
            trashed_at: Some(old),
            ..r
        })
        .await;
        let seen = std::cell::RefCell::new(Vec::new());
        let purged = db
            .auto_purge_old_trashed_files(Some(&|ids: &[String]| {
                seen.borrow_mut().extend_from_slice(ids);
                Ok(())
            }))
            .await
            .unwrap();
        assert_eq!(purged, 1);
        assert!(read_deleted_at(&db, "f1").await.is_some());
        assert_eq!(*seen.borrow(), vec!["f1".to_string()]);
    }

    // Tombstones are permanent markers: a re-tombstone must not move deletedAt, bump
    // updatedAt, or re-flag; a restore must not clear deletedAt.
    #[tokio::test]
    async fn tombstone_is_permanent_across_retombstone_and_restore() {
        let db = test_db().await;
        seed_file(&db, "f1", |r| r).await;
        db.tombstone_files_and_thumbnails(vec!["f1".into()])
            .await
            .unwrap();
        let first = read_deleted_at(&db, "f1").await.unwrap();

        db.tombstone_files_and_thumbnails(vec!["f1".into()])
            .await
            .unwrap();
        assert_eq!(
            read_deleted_at(&db, "f1").await,
            Some(first),
            "re-tombstone must not move the marker"
        );

        db.restore_files_and_thumbnails(vec!["f1".into()])
            .await
            .unwrap();
        assert_eq!(
            read_deleted_at(&db, "f1").await,
            Some(first),
            "restore leaves deletedAt untouched"
        );
    }

    // The purge loop's second non-empty select: >500 expired rows take two batches,
    // and the hook sees each batch's ids exactly once.
    #[tokio::test]
    async fn auto_purge_processes_more_than_one_batch() {
        let db = test_db().await;
        let expired = Utc::now().timestamp_millis() - trash_auto_purge_age() - 1000;
        for i in 0..501 {
            let id = format!("f{i:04}");
            seed_file(&db, &id, |r| FileRecordRow {
                trashed_at: Some(expired),
                ..r
            })
            .await;
        }

        let batches = std::cell::RefCell::new(Vec::new());
        let hook: PurgeBatchHook = &|ids| {
            batches.borrow_mut().push(ids.len());
            Ok(())
        };
        let total = db.auto_purge_old_trashed_files(Some(hook)).await.unwrap();

        assert_eq!(total, 501);
        assert_eq!(*batches.borrow(), vec![500, 1]);
        let remaining: i64 = db
            .transaction(|c| {
                Ok::<_, DbError>(c.query_row(
                    "SELECT COUNT(*) FROM files WHERE trashedAt IS NOT NULL AND deletedAt IS NULL",
                    [],
                    |r| r.get(0),
                )?)
            })
            .await
            .unwrap();
        assert_eq!(remaining, 0);
    }
}
