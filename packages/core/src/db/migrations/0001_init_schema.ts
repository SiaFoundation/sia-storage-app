import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS directories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    createdAt INTEGER NOT NULL
  );`,
  )

  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS files (
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
    deletedAt INTEGER
  );`,
  )

  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_createdAt_id ON files(createdAt, id);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_fileType ON files(type);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_fileName_nocase_id ON files(name COLLATE NOCASE, id);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_updatedAt_id ON files(updatedAt, id);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_thumbForId_thumbSize ON files(thumbForId, thumbSize);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_directoryId ON files(directoryId);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_trashedAt ON files(trashedAt);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_deletedAt ON files(deletedAt);`,
  )

  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS objects (
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
  );`,
  )

  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_objects_id ON objects(id);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_objects_fileId ON objects(fileId);`,
  )

  await db.execAsync(
    // No FK on fileId — fs is a cache managed by fsOrphanScanner/fsEvictionScanner
    `CREATE TABLE IF NOT EXISTS fs (
    fileId TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    addedAt INTEGER NOT NULL,
    usedAt INTEGER NOT NULL
  );`,
  )

  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_fs_addedAt ON fs(addedAt);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_fs_usedAt ON fs(usedAt);`,
  )

  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    level TEXT NOT NULL,
    scope TEXT NOT NULL,
    message TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT
  );`,
  )

  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_logs_level_scope ON logs(level, scope);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_logs_createdAt ON logs(createdAt);`,
  )

  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    createdAt INTEGER NOT NULL,
    usedAt INTEGER NOT NULL,
    system INTEGER NOT NULL DEFAULT 0
  );`,
  )

  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_tags_usedAt ON tags(usedAt);`,
  )

  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS file_tags (
    fileId TEXT NOT NULL,
    tagId TEXT NOT NULL,
    PRIMARY KEY (fileId, tagId),
    FOREIGN KEY (fileId) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
  );`,
  )

  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_file_tags_tagId ON file_tags(tagId);`,
  )

  const now = Date.now()
  await db.runAsync(
    `INSERT OR IGNORE INTO tags (id, name, createdAt, usedAt, system) VALUES (?, ?, ?, ?, 1)`,
    'sys:favorites',
    'Favorites',
    now,
    now,
  )
}

export const migration_0001_init_schema: Migration = {
  id: '0001_init_schema',
  description: 'Initialize storage schema.',
  up,
}
