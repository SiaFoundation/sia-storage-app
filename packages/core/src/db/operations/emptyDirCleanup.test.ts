import { insertFile } from './files'
import { insertDirectory, deleteEmptyDirectories } from './directories'
import { moveFileToDirectory } from './directories'
import { db, setupTestDb, teardownTestDb } from './test-setup'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

const now = Date.now()

async function createTestFile(id: string, name: string) {
  await insertFile(db(), {
    id,
    name,
    type: 'text/plain',
    kind: 'file',
    size: 10,
    hash: `hash-${id}`,
    createdAt: now,
    updatedAt: now,
    localId: null,
    addedAt: now,
    trashedAt: null,
    deletedAt: null,
  })
}

describe('deleteEmptyDirectories', () => {
  it('deletes specified empty directory', async () => {
    const dir = await insertDirectory(db(), 'target')
    const deleted = await deleteEmptyDirectories(db(), [dir.id])
    expect(deleted).toBe(1)
  })

  it('does not delete directory with active files', async () => {
    const dir = await insertDirectory(db(), 'full')
    await createTestFile('f1', 'data.txt')
    await moveFileToDirectory(db(), 'f1', dir.id)

    const deleted = await deleteEmptyDirectories(db(), [dir.id])
    expect(deleted).toBe(0)
  })

  it('deletes directory when all files are trashed', async () => {
    const dir = await insertDirectory(db(), 'trashed')
    await createTestFile('f2', 'doc.txt')
    await moveFileToDirectory(db(), 'f2', dir.id)

    await db().runAsync('UPDATE files SET trashedAt = ? WHERE id = ?', now, 'f2')

    const deleted = await deleteEmptyDirectories(db(), [dir.id])
    expect(deleted).toBe(1)
  })

  it('deletes directory when all files are tombstoned', async () => {
    const dir = await insertDirectory(db(), 'tombstoned')
    await createTestFile('f3', 'old.txt')
    await moveFileToDirectory(db(), 'f3', dir.id)

    await db().runAsync(
      'UPDATE files SET deletedAt = ?, trashedAt = ? WHERE id = ?',
      now,
      now,
      'f3',
    )

    const deleted = await deleteEmptyDirectories(db(), [dir.id])
    expect(deleted).toBe(1)
  })

  it('does not count non-current file versions as active', async () => {
    const dir = await insertDirectory(db(), 'versioned')
    await createTestFile('f4', 'readme.txt')
    await moveFileToDirectory(db(), 'f4', dir.id)

    // Mark as non-current (old version)
    await db().runAsync('UPDATE files SET current = 0 WHERE id = ?', 'f4')

    const deleted = await deleteEmptyDirectories(db(), [dir.id])
    expect(deleted).toBe(1)
  })

  it('walks up and deletes parent if also empty', async () => {
    await insertDirectory(db(), 'outer')
    const child = await insertDirectory(db(), 'inner', 'outer')

    const deleted = await deleteEmptyDirectories(db(), [child.id])
    expect(deleted).toBe(2)
  })

  it('stops at parent that has files', async () => {
    const parent = await insertDirectory(db(), 'parent')
    const child = await insertDirectory(db(), 'child', 'parent')
    await createTestFile('f5', 'keep.txt')
    await moveFileToDirectory(db(), 'f5', parent.id)

    const deleted = await deleteEmptyDirectories(db(), [child.id])
    expect(deleted).toBe(1)
  })

  it('does not delete directory with subdirectories', async () => {
    const parent = await insertDirectory(db(), 'hasChild')
    await insertDirectory(db(), 'sub', 'hasChild')

    const deleted = await deleteEmptyDirectories(db(), [parent.id])
    expect(deleted).toBe(0)
  })

  it('deletes 50 sibling empty directories in one call', async () => {
    const ids: string[] = []
    for (let i = 0; i < 50; i++) {
      const dir = await insertDirectory(db(), `bulk-${i}`)
      ids.push(dir.id)
    }

    const deleted = await deleteEmptyDirectories(db(), ids)
    expect(deleted).toBe(50)

    const remaining = await db().getAllAsync<{ id: string }>('SELECT id FROM directories')
    expect(remaining).toHaveLength(0)
  })

  it('deletes only the empty siblings when input mixes empty and non-empty', async () => {
    const ids: string[] = []
    for (let i = 0; i < 50; i++) {
      const dir = await insertDirectory(db(), `mixed-${i}`)
      ids.push(dir.id)
      if (i % 2 === 0) {
        const fileId = `mixed-f-${i}`
        await createTestFile(fileId, 'data.txt')
        await moveFileToDirectory(db(), fileId, dir.id)
      }
    }

    const deleted = await deleteEmptyDirectories(db(), ids)
    expect(deleted).toBe(25)

    const remaining = await db().getAllAsync<{ id: string }>('SELECT id FROM directories')
    expect(remaining).toHaveLength(25)
  })

  it('cascades through a 5-level deep chain from a single leaf input', async () => {
    await insertDirectory(db(), 'a')
    await insertDirectory(db(), 'b', 'a')
    await insertDirectory(db(), 'c', 'a/b')
    await insertDirectory(db(), 'd', 'a/b/c')
    const leaf = await insertDirectory(db(), 'e', 'a/b/c/d')

    const deleted = await deleteEmptyDirectories(db(), [leaf.id])
    expect(deleted).toBe(5)

    const remaining = await db().getAllAsync<{ id: string }>('SELECT id FROM directories')
    expect(remaining).toHaveLength(0)
  })

  it('handles 20 sibling chains each 4 levels deep', async () => {
    const leafIds: string[] = []
    for (let i = 0; i < 20; i++) {
      const root = `root-${i}`
      await insertDirectory(db(), root)
      await insertDirectory(db(), 'l1', root)
      await insertDirectory(db(), 'l2', `${root}/l1`)
      const leaf = await insertDirectory(db(), 'l3', `${root}/l1/l2`)
      leafIds.push(leaf.id)
    }

    const deleted = await deleteEmptyDirectories(db(), leafIds)
    expect(deleted).toBe(80)

    const remaining = await db().getAllAsync<{ id: string }>('SELECT id FROM directories')
    expect(remaining).toHaveLength(0)
  })

  it('is idempotent', async () => {
    const dir = await insertDirectory(db(), 'idem')
    const child = await insertDirectory(db(), 'sub', 'idem')

    const first = await deleteEmptyDirectories(db(), [child.id])
    expect(first).toBe(2)

    const second = await deleteEmptyDirectories(db(), [child.id, dir.id])
    expect(second).toBe(0)
  })

  it('cascades up but stops at non-empty ancestor', async () => {
    const a = await insertDirectory(db(), 'a-stop')
    await insertDirectory(db(), 'b', 'a-stop')
    const c = await insertDirectory(db(), 'c', 'a-stop/b')
    await createTestFile('keep-in-a', 'kept.txt')
    await moveFileToDirectory(db(), 'keep-in-a', a.id)

    const deleted = await deleteEmptyDirectories(db(), [c.id])
    expect(deleted).toBe(2)

    const remaining = await db().getAllAsync<{ id: string; path: string }>(
      'SELECT id, path FROM directories ORDER BY path',
    )
    expect(remaining.map((r) => r.path)).toEqual(['a-stop'])
  })

  it('ignores non-existent IDs without error', async () => {
    const dir = await insertDirectory(db(), 'real')

    const deleted = await deleteEmptyDirectories(db(), [dir.id, 'bogus-id-1', 'bogus-id-2'])
    expect(deleted).toBe(1)
  })
})
