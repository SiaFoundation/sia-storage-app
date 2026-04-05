import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

async function up(db: DatabaseAdapter): Promise<void> {
  // Directories
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS directories (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL,
      nameSortKey TEXT
    );`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_directories_nameSortKey ON directories(nameSortKey);`,
  )

  // Files
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
      deletedAt INTEGER,
      lostReason TEXT,
      nameSortKey TEXT,
      current INTEGER NOT NULL DEFAULT 1
    );`,
  )
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_files_createdAt_id ON files(createdAt, id);`)
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_files_fileType ON files(type);`)
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_files_updatedAt_id ON files(updatedAt, id);`)
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);`)
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);`)
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_thumbForId_thumbSize ON files(thumbForId, thumbSize);`,
  )
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_files_directoryId ON files(directoryId);`)
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_files_trashedAt ON files(trashedAt);`)
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_files_deletedAt ON files(deletedAt);`)
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_files_addedAt_id ON files(addedAt, id);`)
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_nameSortKey_id ON files(nameSortKey, id);`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_nameSortKey
     ON files(nameSortKey, id)
     WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_version_group
     ON files(name, directoryId, updatedAt DESC, id DESC)
     WHERE kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_createdAt
     ON files(createdAt DESC, id DESC)
     WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_addedAt
     ON files(addedAt DESC, id DESC)
     WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_size
     ON files(size DESC, id DESC)
     WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_type
     ON files(type)
     WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_directoryId
     ON files(directoryId)
     WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;`,
  )
  await db.execAsync(
    `CREATE INDEX IF NOT EXISTS idx_files_current_name_directoryId
     ON files(name, directoryId)
     WHERE current = 1 AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL;`,
  )

  // Objects (file metadata from indexers)
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
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_objects_id ON objects(id);`)
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_objects_fileId ON objects(fileId);`)

  // Local filesystem cache
  // No FK on fileId — fs is a cache managed by fsOrphanScanner/fsEvictionScanner
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS fs (
      fileId TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      addedAt INTEGER NOT NULL,
      usedAt INTEGER NOT NULL
    );`,
  )
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_fs_addedAt ON fs(addedAt);`)
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_fs_usedAt ON fs(usedAt);`)

  // Logs
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
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_logs_level_scope ON logs(level, scope);`)
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_logs_createdAt ON logs(createdAt);`)

  // Tags
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL,
      usedAt INTEGER NOT NULL,
      system INTEGER NOT NULL DEFAULT 0
    );`,
  )
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_tags_usedAt ON tags(usedAt);`)

  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS file_tags (
      fileId TEXT NOT NULL,
      tagId TEXT NOT NULL,
      PRIMARY KEY (fileId, tagId),
      FOREIGN KEY (fileId) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
    );`,
  )
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_file_tags_tagId ON file_tags(tagId);`)

  // Default system tag
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
