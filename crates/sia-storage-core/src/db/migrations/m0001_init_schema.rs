use rusqlite::{Connection, params};

use crate::db::DbError;
use crate::db::types::Migration;

const SCHEMA: &str = r"
CREATE TABLE IF NOT EXISTS directories (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    createdAt INTEGER NOT NULL,
    nameSortKey TEXT
);
CREATE INDEX IF NOT EXISTS idx_directories_nameSortKey ON directories(nameSortKey);

CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    localId TEXT UNIQUE,
    addedAt INTEGER NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    type TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'file',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    hash TEXT NOT NULL,
    thumbForId TEXT,
    thumbSize INTEGER,
    directoryId TEXT REFERENCES directories(id) ON DELETE SET NULL,
    trashedAt INTEGER,
    deletedAt INTEGER,
    lostReason TEXT,
    nameSortKey TEXT,
    current INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_files_createdAt_id ON files(createdAt, id);
CREATE INDEX IF NOT EXISTS idx_files_fileType ON files(type);
CREATE INDEX IF NOT EXISTS idx_files_updatedAt_id ON files(updatedAt, id);
CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
CREATE INDEX IF NOT EXISTS idx_files_thumbForId_thumbSize ON files(thumbForId, thumbSize);
CREATE INDEX IF NOT EXISTS idx_files_directoryId ON files(directoryId);
CREATE INDEX IF NOT EXISTS idx_files_trashedAt ON files(trashedAt);
CREATE INDEX IF NOT EXISTS idx_files_deletedAt ON files(deletedAt);
CREATE INDEX IF NOT EXISTS idx_files_addedAt_id ON files(addedAt, id);
CREATE INDEX IF NOT EXISTS idx_files_nameSortKey_id ON files(nameSortKey, id);
CREATE INDEX IF NOT EXISTS idx_files_current_nameSortKey
    ON files(nameSortKey, id)
    WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_version_group
    ON files(name, directoryId, updatedAt DESC, id DESC)
    WHERE kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_current_createdAt
    ON files(createdAt DESC, id DESC)
    WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_current_addedAt
    ON files(addedAt DESC, id DESC)
    WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_current_size
    ON files(size DESC, id DESC)
    WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_current_type
    ON files(type)
    WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_current_directoryId
    ON files(directoryId)
    WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_current_name_directoryId
    ON files(name, directoryId)
    WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;

CREATE TABLE IF NOT EXISTS objects (
    fileId TEXT NOT NULL,
    indexerURL TEXT NOT NULL,
    id TEXT NOT NULL,
    slabs TEXT NOT NULL,
    encryptedDataKey TEXT NOT NULL,
    encryptedMetadataKey TEXT NOT NULL,
    encryptedMetadata TEXT NOT NULL,
    dataSignature TEXT NOT NULL,
    metadataSignature TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    PRIMARY KEY (indexerURL, id),
    FOREIGN KEY (fileId) REFERENCES files(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_objects_id ON objects(id);
CREATE INDEX IF NOT EXISTS idx_objects_fileId ON objects(fileId);

-- Local filesystem cache. No FK on fileId: the cache outlives FK guarantees and is reconciled by
-- orphan and eviction scanners.
CREATE TABLE IF NOT EXISTS fs (
    fileId TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    addedAt INTEGER NOT NULL,
    usedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fs_addedAt ON fs(addedAt);
CREATE INDEX IF NOT EXISTS idx_fs_usedAt ON fs(usedAt);

CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    scope TEXT NOT NULL,
    message TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_level_scope ON logs(level, scope);
CREATE INDEX IF NOT EXISTS idx_logs_createdAt ON logs(createdAt);

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    createdAt INTEGER NOT NULL,
    usedAt INTEGER NOT NULL,
    system INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tags_usedAt ON tags(usedAt);

CREATE TABLE IF NOT EXISTS file_tags (
    fileId TEXT NOT NULL,
    tagId TEXT NOT NULL,
    PRIMARY KEY (fileId, tagId),
    FOREIGN KEY (fileId) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_file_tags_tagId ON file_tags(tagId);
";

fn up(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch(SCHEMA)?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT OR IGNORE INTO tags (id, name, createdAt, usedAt, system) VALUES (?, ?, ?, ?, 1)",
        params!["sys:favorites", "Favorites", now, now],
    )?;
    Ok(())
}

pub fn migration_0001_init_schema() -> Migration {
    Migration {
        id: "0001_init_schema".into(),
        description: "Initialize storage schema.".into(),
        up,
    }
}
