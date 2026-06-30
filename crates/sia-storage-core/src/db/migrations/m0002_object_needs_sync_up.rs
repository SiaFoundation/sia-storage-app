use rusqlite::Connection;

use crate::db::DbError;

pub(crate) fn up(conn: &Connection) -> Result<(), DbError> {
    // Flag every existing object once so the first post-upgrade sync-up pass reconciles it (a
    // no-diff pass clears it). Never-uploaded files have no object row, so they are excluded.
    // The partial index covers the sync-up batch query (`indexerURL = ? AND needsSyncUp = 1`).
    conn.execute_batch(
        r"ALTER TABLE objects ADD COLUMN needsSyncUp INTEGER NOT NULL DEFAULT 0;
          UPDATE objects SET needsSyncUp = 1;
          CREATE INDEX IF NOT EXISTS idx_objects_needs_sync_up
              ON objects(indexerURL, id)
              WHERE needsSyncUp = 1;",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::db::migrations::CORE_MIGRATIONS;
    use crate::db::runner::run_migrations;
    use rusqlite::Connection;

    #[test]
    fn backfill_flags_existing_objects_as_needing_sync_up() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn, &CORE_MIGRATIONS[..1], None).unwrap();
        conn.execute(
            "INSERT INTO files (id, addedAt, name, size, type, createdAt, updatedAt, hash) \
             VALUES ('file-1', 0, 'f', 0, 'file', 0, 0, '')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO objects (fileId, indexerURL, id, slabs, encryptedDataKey, \
             encryptedMetadataKey, encryptedMetadata, dataSignature, metadataSignature, \
             createdAt, updatedAt) VALUES (?, ?, ?, '[]', '', '', '', '', '', 0, 0)",
            rusqlite::params!["file-1", "https://indexer", "obj-1"],
        )
        .unwrap();

        run_migrations(&mut conn, CORE_MIGRATIONS, None).unwrap();

        let needs_sync_up: i64 = conn
            .query_row(
                "SELECT needsSyncUp FROM objects WHERE id = 'obj-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(needs_sync_up, 1);
    }
}
