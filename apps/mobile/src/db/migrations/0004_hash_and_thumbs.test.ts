import { db, initializeDB, resetDb } from '..'

jest.mock('@siastorage/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

describe('migration 0004_hash_and_thumbs', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
  })

  describe('schema after migration', () => {
    it('files table has kind column', async () => {
      const cols = await db().getAllAsync<{ name: string }>(
        'PRAGMA table_info(files)',
      )
      const colNames = cols.map((c) => c.name)
      expect(colNames).toContain('kind')
    })

    it('files table has thumbForId column (not thumbForHash)', async () => {
      const cols = await db().getAllAsync<{ name: string }>(
        'PRAGMA table_info(files)',
      )
      const colNames = cols.map((c) => c.name)
      expect(colNames).toContain('thumbForId')
      expect(colNames).not.toContain('thumbForHash')
    })

    it('hash column is not unique', async () => {
      // Insert two rows with the same hash — should not throw
      await db().runAsync(
        `INSERT INTO files (id, localId, addedAt, name, size, type, kind, createdAt, updatedAt, hash)
         VALUES ('f1', 'l1', 1, 'a.jpg', 100, 'image/jpeg', 'file', 1000, 2000, 'same-hash')`,
      )
      await db().runAsync(
        `INSERT INTO files (id, localId, addedAt, name, size, type, kind, createdAt, updatedAt, hash)
         VALUES ('f2', 'l2', 2, 'b.jpg', 200, 'image/jpeg', 'file', 1000, 2000, 'same-hash')`,
      )
      const rows = await db().getAllAsync<{ id: string }>(
        `SELECT id FROM files WHERE hash = 'same-hash'`,
      )
      expect(rows).toHaveLength(2)
    })

    it('thumbForId + thumbSize allows duplicates', async () => {
      await db().runAsync(
        `INSERT INTO files (id, localId, addedAt, name, size, type, kind, createdAt, updatedAt, hash)
         VALUES ('f1', 'l1', 1, 'parent.jpg', 100, 'image/jpeg', 'file', 1000, 2000, 'fh')`,
      )
      await db().runAsync(
        `INSERT INTO files (id, localId, addedAt, name, size, type, kind, createdAt, updatedAt, hash, thumbForId, thumbSize)
         VALUES ('t1', 'lt1', 2, 'parent.jpg', 50, 'image/jpeg', 'thumb', 1000, 2000, 'th', 'f1', 64)`,
      )
      await db().runAsync(
        `INSERT INTO files (id, localId, addedAt, name, size, type, kind, createdAt, updatedAt, hash, thumbForId, thumbSize)
         VALUES ('t2', 'lt2', 3, 'parent.jpg', 50, 'image/jpeg', 'thumb', 1000, 2000, 'th2', 'f1', 64)`,
      )
      const rows = await db().getAllAsync<{ id: string }>(
        `SELECT id FROM files WHERE thumbForId = 'f1' AND thumbSize = 64`,
      )
      expect(rows).toHaveLength(2)
    })

    it('kind defaults to file', async () => {
      await db().runAsync(
        `INSERT INTO files (id, localId, addedAt, name, size, type, createdAt, updatedAt, hash)
         VALUES ('f1', 'l1', 1, 'a.jpg', 100, 'image/jpeg', 1000, 2000, 'h1')`,
      )
      const row = await db().getFirstAsync<{ kind: string }>(
        `SELECT kind FROM files WHERE id = 'f1'`,
      )
      expect(row?.kind).toBe('file')
    })

    it('has idx_files_kind index', async () => {
      const indexes = await db().getAllAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='files'`,
      )
      const indexNames = indexes.map((i) => i.name)
      expect(indexNames).toContain('idx_files_kind')
    })

    it('has idx_files_hash index', async () => {
      const indexes = await db().getAllAsync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='files'`,
      )
      const indexNames = indexes.map((i) => i.name)
      expect(indexNames).toContain('idx_files_hash')
    })
  })

  describe('data migration (simulated old schema)', () => {
    /**
     * These tests simulate the upgrade path by:
     * 1. Dropping the files table (undoing migrations)
     * 2. Creating the old schema (with thumbForHash, UNIQUE hash)
     * 3. Inserting test data
     * 4. Running the migration function directly
     */
    async function setupOldSchemaWithData(
      rows: Array<{
        id: string
        localId: string | null
        addedAt: number
        name: string
        size: number
        type: string
        createdAt: number
        updatedAt: number
        hash: string
        thumbForHash: string | null
        thumbSize: number | null
      }>,
    ) {
      // Remove the migration record so we can re-run it
      await db().runAsync(
        `DELETE FROM migrations WHERE id = '0004_hash_and_thumbs'`,
      )

      // Drop the new-schema files table
      await db().execAsync('DROP TABLE IF EXISTS files')

      // Create old schema (before 0004)
      await db().execAsync(`
        CREATE TABLE files (
          id TEXT PRIMARY KEY,
          localId TEXT UNIQUE,
          addedAt INTEGER NOT NULL,
          name TEXT NOT NULL,
          size INTEGER NOT NULL,
          type TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          hash TEXT NOT NULL UNIQUE,
          thumbForHash TEXT,
          thumbSize INTEGER
        )
      `)

      // Insert test data
      for (const row of rows) {
        await db().runAsync(
          `INSERT INTO files (id, localId, addedAt, name, size, type, createdAt, updatedAt, hash, thumbForHash, thumbSize)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id,
          row.localId,
          row.addedAt,
          row.name,
          row.size,
          row.type,
          row.createdAt,
          row.updatedAt,
          row.hash,
          row.thumbForHash,
          row.thumbSize,
        )
      }

      // Run the migration
      const {
        migration_0004_hash_and_thumbs,
      } = require('@siastorage/core/db/migrations/0004_hash_and_thumbs')
      await migration_0004_hash_and_thumbs.up(db())
    }

    it('derives kind=file for files (no thumbForHash)', async () => {
      await setupOldSchemaWithData([
        {
          id: 'f1',
          localId: 'l1',
          addedAt: 1,
          name: 'photo.jpg',
          size: 1024,
          type: 'image/jpeg',
          createdAt: 1000,
          updatedAt: 2000,
          hash: 'file-hash',
          thumbForHash: null,
          thumbSize: null,
        },
      ])

      const row = await db().getFirstAsync<{
        kind: string
        thumbForId: string | null
      }>(`SELECT kind, thumbForId FROM files WHERE id = 'f1'`)
      expect(row?.kind).toBe('file')
      expect(row?.thumbForId).toBeNull()
    })

    it('derives kind=thumb and resolves thumbForId for thumbnails', async () => {
      await setupOldSchemaWithData([
        {
          id: 'f1',
          localId: 'l1',
          addedAt: 1,
          name: 'photo.jpg',
          size: 1024,
          type: 'image/jpeg',
          createdAt: 1000,
          updatedAt: 2000,
          hash: 'file-hash',
          thumbForHash: null,
          thumbSize: null,
        },
        {
          id: 't1',
          localId: 'lt1',
          addedAt: 2,
          name: 'photo.jpg',
          size: 200,
          type: 'image/jpeg',
          createdAt: 1000,
          updatedAt: 2000,
          hash: 'thumb-hash',
          thumbForHash: 'file-hash',
          thumbSize: 64,
        },
      ])

      const thumb = await db().getFirstAsync<{
        kind: string
        thumbForId: string | null
        thumbSize: number | null
      }>(`SELECT kind, thumbForId, thumbSize FROM files WHERE id = 't1'`)
      expect(thumb?.kind).toBe('thumb')
      expect(thumb?.thumbForId).toBe('f1')
      expect(thumb?.thumbSize).toBe(64)
    })

    it('handles orphaned thumbnail (parent hash not found)', async () => {
      await setupOldSchemaWithData([
        {
          id: 't-orphan',
          localId: 'lt-o',
          addedAt: 1,
          name: 'orphan.jpg',
          size: 100,
          type: 'image/jpeg',
          createdAt: 1000,
          updatedAt: 2000,
          hash: 'orphan-thumb-hash',
          thumbForHash: 'missing-parent-hash',
          thumbSize: 64,
        },
      ])

      const thumb = await db().getFirstAsync<{
        kind: string
        thumbForId: string | null
      }>(`SELECT kind, thumbForId FROM files WHERE id = 't-orphan'`)
      expect(thumb?.kind).toBe('thumb')
      // thumbForId is NULL because the parent hash doesn't exist
      expect(thumb?.thumbForId).toBeNull()
    })

    it('preserves all non-thumb columns', async () => {
      await setupOldSchemaWithData([
        {
          id: 'f1',
          localId: 'local-1',
          addedAt: 42,
          name: 'test.png',
          size: 9999,
          type: 'image/png',
          createdAt: 5000,
          updatedAt: 6000,
          hash: 'preserve-hash',
          thumbForHash: null,
          thumbSize: null,
        },
      ])

      const row = await db().getFirstAsync<any>(
        `SELECT * FROM files WHERE id = 'f1'`,
      )
      expect(row.localId).toBe('local-1')
      expect(row.addedAt).toBe(42)
      expect(row.name).toBe('test.png')
      expect(row.size).toBe(9999)
      expect(row.type).toBe('image/png')
      expect(row.createdAt).toBe(5000)
      expect(row.updatedAt).toBe(6000)
      expect(row.hash).toBe('preserve-hash')
    })

    it('handles multiple thumbnails for the same file', async () => {
      await setupOldSchemaWithData([
        {
          id: 'f1',
          localId: 'l1',
          addedAt: 1,
          name: 'photo.jpg',
          size: 1024,
          type: 'image/jpeg',
          createdAt: 1000,
          updatedAt: 2000,
          hash: 'fh',
          thumbForHash: null,
          thumbSize: null,
        },
        {
          id: 't-64',
          localId: 'lt64',
          addedAt: 2,
          name: 'photo.jpg',
          size: 100,
          type: 'image/jpeg',
          createdAt: 1000,
          updatedAt: 2000,
          hash: 'th64',
          thumbForHash: 'fh',
          thumbSize: 64,
        },
        {
          id: 't-512',
          localId: 'lt512',
          addedAt: 3,
          name: 'photo.jpg',
          size: 500,
          type: 'image/jpeg',
          createdAt: 1000,
          updatedAt: 2000,
          hash: 'th512',
          thumbForHash: 'fh',
          thumbSize: 512,
        },
      ])

      const thumbs = await db().getAllAsync<{
        id: string
        kind: string
        thumbForId: string
        thumbSize: number
      }>(
        `SELECT id, kind, thumbForId, thumbSize FROM files WHERE kind = 'thumb' ORDER BY thumbSize`,
      )
      expect(thumbs).toHaveLength(2)
      expect(thumbs[0].thumbForId).toBe('f1')
      expect(thumbs[0].thumbSize).toBe(64)
      expect(thumbs[1].thumbForId).toBe('f1')
      expect(thumbs[1].thumbSize).toBe(512)
    })

    it('is idempotent (skip guard for already-migrated schema)', async () => {
      // First run via setupOldSchemaWithData
      await setupOldSchemaWithData([
        {
          id: 'f1',
          localId: 'l1',
          addedAt: 1,
          name: 'a.jpg',
          size: 100,
          type: 'image/jpeg',
          createdAt: 1000,
          updatedAt: 2000,
          hash: 'h1',
          thumbForHash: null,
          thumbSize: null,
        },
      ])

      // Running migration again should be safe (guard detects kind column exists)
      const {
        migration_0004_hash_and_thumbs,
      } = require('@siastorage/core/db/migrations/0004_hash_and_thumbs')
      await expect(
        migration_0004_hash_and_thumbs.up(db()),
      ).resolves.not.toThrow()

      // Data should be unchanged
      const row = await db().getFirstAsync<{ id: string; kind: string }>(
        `SELECT id, kind FROM files WHERE id = 'f1'`,
      )
      expect(row?.kind).toBe('file')
    })
  })
})
