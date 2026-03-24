import { queryAllDirectoriesWithCounts } from './directories'
import {
  deleteFileRecordAndThumbnails,
  deleteManyFileRecordsByIds,
  insertFileRecord,
  insertManyFileRecords,
  moveAllFileVersions,
  queryFileRecordByName,
  queryFileVersions,
  recalculateCurrentForGroup,
  renameAllFileVersions,
  trashAllFileVersions,
} from './files'
import {
  queryDirectoryFileCount,
  queryFileCountWithFilters,
  queryLibraryFileCount,
  queryMediaFileCount,
  queryTagFileCount,
  queryUnfiledFileCount,
} from './library'
import { addTagToFile, queryTagsForFile } from './tags'
import { db, setupTestDb, teardownTestDb } from './test-setup'
import { restoreFiles, trashFiles } from './trash'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

const base = 1000

async function createFile(
  id: string,
  overrides?: Partial<{
    name: string
    type: string
    createdAt: number
    updatedAt: number
    size: number
    directoryId: string | null
  }>,
) {
  await insertFileRecord(db(), {
    id,
    name: overrides?.name ?? `${id}.jpg`,
    type: overrides?.type ?? 'image/jpeg',
    kind: 'file',
    size: overrides?.size ?? 100,
    hash: `hash-${id}`,
    createdAt: overrides?.createdAt ?? base,
    updatedAt: overrides?.updatedAt ?? overrides?.createdAt ?? base,
    localId: null,
    addedAt: overrides?.createdAt ?? base,
    trashedAt: null,
    deletedAt: null,
  })
  if (overrides?.directoryId) {
    await db().runAsync(
      'UPDATE files SET directoryId = ? WHERE id = ?',
      overrides.directoryId,
      id,
    )
    await recalculateCurrentForGroup(
      db(),
      overrides?.name ?? `${id}.jpg`,
      overrides.directoryId,
    )
  }
}

async function createDirectory(id: string, name: string) {
  await db().runAsync(
    'INSERT INTO directories (id, name, createdAt) VALUES (?, ?, ?)',
    id,
    name,
    base,
  )
}

describe('version filtering', () => {
  test('two files same name+dir → library count = 1, shows latest by updatedAt', async () => {
    await createFile('v1', { name: 'foo.txt', updatedAt: base })
    await createFile('v2', { name: 'foo.txt', updatedAt: base + 100 })

    const count = await queryLibraryFileCount(db())
    expect(count).toBe(1)

    const latest = await queryFileRecordByName(db(), 'foo.txt')
    expect(latest?.id).toBe('v2')
  })

  test('files same name DIFFERENT directories are not versions', async () => {
    await createDirectory('dir-a', 'Photos')
    await createDirectory('dir-b', 'Documents')
    await createFile('f1', {
      name: 'report.txt',
      directoryId: 'dir-a',
      updatedAt: base,
    })
    await createFile('f2', {
      name: 'report.txt',
      directoryId: 'dir-b',
      updatedAt: base + 100,
    })

    const count = await queryLibraryFileCount(db())
    expect(count).toBe(2)
  })

  test('unfiled files (directoryId IS NULL) with same name grouped correctly', async () => {
    await createFile('v1', { name: 'notes.txt', updatedAt: base })
    await createFile('v2', { name: 'notes.txt', updatedAt: base + 100 })

    const count = await queryUnfiledFileCount(db())
    expect(count).toBe(1)
  })

  test('version history returns all versions ordered by updatedAt DESC', async () => {
    await createFile('v1', { name: 'foo.txt', updatedAt: base })
    await createFile('v2', { name: 'foo.txt', updatedAt: base + 100 })
    await createFile('v3', { name: 'foo.txt', updatedAt: base + 200 })

    const versions = await queryFileVersions(db(), 'foo.txt', null)
    expect(versions).toHaveLength(3)
    expect(versions[0].id).toBe('v3')
    expect(versions[1].id).toBe('v2')
    expect(versions[2].id).toBe('v1')
  })

  test('queryFileRecordByName returns latest version', async () => {
    await createFile('old', { name: 'test.txt', updatedAt: base })
    await createFile('new', { name: 'test.txt', updatedAt: base + 500 })

    const result = await queryFileRecordByName(db(), 'test.txt')
    expect(result?.id).toBe('new')
  })

  test('media count only counts latest versions', async () => {
    await createFile('v1', {
      name: 'photo.jpg',
      type: 'image/jpeg',
      updatedAt: base,
    })
    await createFile('v2', {
      name: 'photo.jpg',
      type: 'image/jpeg',
      updatedAt: base + 100,
    })
    await createFile('video1', {
      name: 'clip.mp4',
      type: 'video/mp4',
      updatedAt: base,
    })

    const count = await queryMediaFileCount(db())
    expect(count).toBe(2)
  })

  test('directory file count only counts latest versions', async () => {
    await createDirectory('dir-1', 'Photos')
    await createFile('v1', {
      name: 'a.jpg',
      directoryId: 'dir-1',
      updatedAt: base,
    })
    await createFile('v2', {
      name: 'a.jpg',
      directoryId: 'dir-1',
      updatedAt: base + 100,
    })
    await createFile('b', {
      name: 'b.jpg',
      directoryId: 'dir-1',
      updatedAt: base,
    })

    const count = await queryDirectoryFileCount(db(), 'dir-1')
    expect(count).toBe(2)
  })

  test('queryAllDirectoriesWithCounts counts latest versions only', async () => {
    await createDirectory('dir-1', 'Photos')
    await createFile('v1', {
      name: 'a.jpg',
      directoryId: 'dir-1',
      updatedAt: base,
    })
    await createFile('v2', {
      name: 'a.jpg',
      directoryId: 'dir-1',
      updatedAt: base + 100,
    })

    const dirs = await queryAllDirectoriesWithCounts(db())
    const photos = dirs.find((d) => d.name === 'Photos')
    expect(photos?.fileCount).toBe(1)
  })

  test('queryFileCountWithFilters counts latest versions only', async () => {
    await createFile('v1', {
      name: 'doc.pdf',
      type: 'application/pdf',
      updatedAt: base,
    })
    await createFile('v2', {
      name: 'doc.pdf',
      type: 'application/pdf',
      updatedAt: base + 100,
    })

    const count = await queryFileCountWithFilters(db(), {})
    expect(count).toBe(1)
  })

  test('tag on old version: queryTagFileCount excludes file when newer untagged version exists', async () => {
    await createFile('v1', { name: 'tagged.txt', updatedAt: base })
    await addTagToFile(db(), 'v1', 'work')
    // v2 must have updatedAt higher than v1's post-tag updatedAt (Date.now())
    const futureTs = Date.now() + 1000
    await createFile('v2', { name: 'tagged.txt', updatedAt: futureTs })

    const tags = await queryTagsForFile(db(), 'v1')
    expect(tags).toHaveLength(1)

    const tagCount = await queryTagFileCount(db(), tags[0].id)
    expect(tagCount).toBe(0)
  })
})

describe('rename-all with staggered timestamps', () => {
  test('preserves version ordering', async () => {
    await createFile('v1', { name: 'foo.txt', updatedAt: base })
    await createFile('v2', { name: 'foo.txt', updatedAt: base + 100 })
    await createFile('v3', { name: 'foo.txt', updatedAt: base + 200 })

    await renameAllFileVersions(db(), 'foo.txt', null, 'bar.txt')

    const versions = await queryFileVersions(db(), 'bar.txt', null)
    expect(versions).toHaveLength(3)
    expect(versions[0].id).toBe('v3')
    expect(versions[1].id).toBe('v2')
    expect(versions[2].id).toBe('v1')
    expect(versions[0].name).toBe('bar.txt')
    expect(versions[0].updatedAt).toBeGreaterThan(versions[1].updatedAt)
    expect(versions[1].updatedAt).toBeGreaterThan(versions[2].updatedAt)
  })

  test('rename triggers updatedAt bump on all versions', async () => {
    await createFile('v1', { name: 'old.txt', updatedAt: base })
    await createFile('v2', { name: 'old.txt', updatedAt: base + 100 })

    await renameAllFileVersions(db(), 'old.txt', null, 'new.txt')

    const versions = await queryFileVersions(db(), 'new.txt', null)
    for (const v of versions) {
      expect(v.updatedAt).toBeGreaterThan(base + 100)
    }
  })
})

describe('move-all with staggered timestamps', () => {
  test('preserves version ordering', async () => {
    await createDirectory('dir-a', 'Source')
    await createDirectory('dir-b', 'Dest')
    await createFile('v1', {
      name: 'file.txt',
      directoryId: 'dir-a',
      updatedAt: base,
    })
    await createFile('v2', {
      name: 'file.txt',
      directoryId: 'dir-a',
      updatedAt: base + 100,
    })

    const ids = await moveAllFileVersions(db(), 'file.txt', 'dir-a', 'dir-b')
    expect(ids).toHaveLength(2)

    const versions = await queryFileVersions(db(), 'file.txt', 'dir-b')
    expect(versions).toHaveLength(2)
    expect(versions[0].id).toBe('v2')
    expect(versions[1].id).toBe('v1')
  })

  test('move-merge: moving into directory with same-named file merges version histories', async () => {
    await createDirectory('dir-a', 'Source')
    await createDirectory('dir-b', 'Dest')
    await createFile('a1', {
      name: 'report.txt',
      directoryId: 'dir-a',
      updatedAt: base,
    })
    await createFile('a2', {
      name: 'report.txt',
      directoryId: 'dir-a',
      updatedAt: base + 100,
    })
    await createFile('a3', {
      name: 'report.txt',
      directoryId: 'dir-a',
      updatedAt: base + 200,
    })
    await createFile('b1', {
      name: 'report.txt',
      directoryId: 'dir-b',
      updatedAt: base + 50,
    })
    await createFile('b2', {
      name: 'report.txt',
      directoryId: 'dir-b',
      updatedAt: base + 150,
    })
    await createFile('b3', {
      name: 'report.txt',
      directoryId: 'dir-b',
      updatedAt: base + 250,
    })

    // Move A's versions into dir-b (where B's versions already exist)
    const ids = await moveAllFileVersions(db(), 'report.txt', 'dir-a', 'dir-b')
    expect(ids).toHaveLength(3)

    // dir-b now has all 6 versions merged
    const versions = await queryFileVersions(db(), 'report.txt', 'dir-b')
    expect(versions).toHaveLength(6)

    // A's latest version should be current (moved most recently, gets updatedAt=now)
    expect(versions[0].id).toBe('a3')

    // dir-a should have no versions left
    const sourceVersions = await queryFileVersions(db(), 'report.txt', 'dir-a')
    expect(sourceVersions).toHaveLength(0)

    // Library should count 1 file (the merged group in dir-b)
    const count = await queryLibraryFileCount(db())
    expect(count).toBe(1)
  })

  test('moving all versions updates folder counts correctly', async () => {
    await createDirectory('dir-a', 'Source')
    await createDirectory('dir-b', 'Dest')
    await createFile('v1', {
      name: 'photo.jpg',
      directoryId: 'dir-a',
      updatedAt: base,
    })
    await createFile('v2', {
      name: 'photo.jpg',
      directoryId: 'dir-a',
      updatedAt: base + 100,
    })

    const dirsBefore = await queryAllDirectoriesWithCounts(db())
    expect(dirsBefore.find((d) => d.name === 'Source')!.fileCount).toBe(1)
    expect(dirsBefore.find((d) => d.name === 'Dest')!.fileCount).toBe(0)

    await moveAllFileVersions(db(), 'photo.jpg', 'dir-a', 'dir-b')

    const dirsAfter = await queryAllDirectoriesWithCounts(db())
    expect(dirsAfter.find((d) => d.name === 'Source')!.fileCount).toBe(0)
    expect(dirsAfter.find((d) => d.name === 'Dest')!.fileCount).toBe(1)

    const totalCount = await queryLibraryFileCount(db())
    expect(totalCount).toBe(1)
  })

  test('single version arriving via sync with different directory resolves correctly', async () => {
    await createDirectory('dir-a', 'FolderA')
    await createDirectory('dir-b', 'FolderB')

    // v1 and v2 are in dir-a
    await createFile('v1', {
      name: 'doc.txt',
      directoryId: 'dir-a',
      updatedAt: base,
    })
    await createFile('v2', {
      name: 'doc.txt',
      directoryId: 'dir-a',
      updatedAt: base + 100,
    })

    expect(await queryLibraryFileCount(db())).toBe(1)
    expect(await queryDirectoryFileCount(db(), 'dir-a')).toBe(1)

    // A sync event moves only v1 to dir-b (unusual, but should resolve)
    await db().runAsync(
      'UPDATE files SET directoryId = ? WHERE id = ?',
      'dir-b',
      'v1',
    )
    await recalculateCurrentForGroup(db(), 'doc.txt', 'dir-a')
    await recalculateCurrentForGroup(db(), 'doc.txt', 'dir-b')

    // dir-a still has v2 (current), dir-b has v1 (current there)
    expect(await queryDirectoryFileCount(db(), 'dir-a')).toBe(1)
    expect(await queryDirectoryFileCount(db(), 'dir-b')).toBe(1)
    expect(await queryLibraryFileCount(db())).toBe(2)
  })

  test('rename within directory: files with same directoryId', async () => {
    await createDirectory('dir-1', 'Photos')
    await createFile('old1', {
      name: 'old.txt',
      directoryId: 'dir-1',
      updatedAt: base,
    })
    await createFile('old2', {
      name: 'old.txt',
      directoryId: 'dir-1',
      updatedAt: base + 100,
    })
    await createFile('existing', {
      name: 'new.txt',
      directoryId: 'dir-1',
      updatedAt: base + 50,
    })

    // Rename old.txt → new.txt within dir-1 (merges with existing new.txt)
    await renameAllFileVersions(db(), 'old.txt', 'dir-1', 'new.txt')

    const versions = await queryFileVersions(db(), 'new.txt', 'dir-1')
    expect(versions).toHaveLength(3)

    // old2 was renamed most recently → becomes current
    expect(versions[0].id).toBe('old2')

    // No old.txt versions remain
    const oldVersions = await queryFileVersions(db(), 'old.txt', 'dir-1')
    expect(oldVersions).toHaveLength(0)

    const dirCount = await queryDirectoryFileCount(db(), 'dir-1')
    expect(dirCount).toBe(1)
  })
})

describe('trash cascades to all versions', () => {
  test('trashAllFileVersions trashes all versions', async () => {
    await createFile('v1', { name: 'file.txt', updatedAt: base })
    await createFile('v2', { name: 'file.txt', updatedAt: base + 100 })
    await createFile('v3', { name: 'file.txt', updatedAt: base + 200 })

    const ids = await trashAllFileVersions(db(), 'file.txt', null)
    expect(ids).toHaveLength(3)

    const count = await queryLibraryFileCount(db())
    expect(count).toBe(0)

    const versions = await queryFileVersions(db(), 'file.txt', null)
    expect(versions).toHaveLength(0)
  })
})

describe('rename merge', () => {
  test('file B renamed to match A → B becomes current', async () => {
    await createFile('a1', { name: 'foo.txt', updatedAt: base })
    await createFile('b1', { name: 'bar.txt', updatedAt: base + 50 })

    await renameAllFileVersions(db(), 'bar.txt', null, 'foo.txt')

    const versions = await queryFileVersions(db(), 'foo.txt', null)
    expect(versions).toHaveLength(2)
    expect(versions[0].id).toBe('b1')

    const count = await queryLibraryFileCount(db())
    expect(count).toBe(1)

    const latest = await queryFileRecordByName(db(), 'foo.txt')
    expect(latest?.id).toBe('b1')
  })

  test('A has 3 versions, B has 2 → merged group has 5, B latest is current', async () => {
    await createFile('a1', { name: 'foo.txt', updatedAt: base })
    await createFile('a2', { name: 'foo.txt', updatedAt: base + 100 })
    await createFile('a3', { name: 'foo.txt', updatedAt: base + 200 })
    await createFile('b1', { name: 'bar.txt', updatedAt: base + 50 })
    await createFile('b2', { name: 'bar.txt', updatedAt: base + 150 })

    await renameAllFileVersions(db(), 'bar.txt', null, 'foo.txt')

    const versions = await queryFileVersions(db(), 'foo.txt', null)
    expect(versions).toHaveLength(5)
    expect(versions[0].id).toBe('b2')

    const count = await queryLibraryFileCount(db())
    expect(count).toBe(1)
  })
})

describe('local version creation inherits metadata', () => {
  test('new version inherits tags from previous current version', async () => {
    await createFile('v1', { name: 'doc.txt', updatedAt: base })
    await addTagToFile(db(), 'v1', 'work')
    await addTagToFile(db(), 'v1', 'important')

    const v1Tags = await queryTagsForFile(db(), 'v1')
    expect(v1Tags).toHaveLength(2)

    await createFile('v2', { name: 'doc.txt', updatedAt: base + 100 })
    for (const tag of v1Tags) {
      await db().runAsync(
        'INSERT INTO file_tags (fileId, tagId) VALUES (?, ?)',
        'v2',
        tag.id,
      )
    }

    const v2Tags = await queryTagsForFile(db(), 'v2')
    expect(v2Tags).toHaveLength(2)

    const tagCount = await queryTagFileCount(db(), v1Tags[0].id)
    expect(tagCount).toBe(1)
  })

  test('new version inherits directory from previous current version', async () => {
    await createDirectory('dir-1', 'Photos')
    await createFile('v1', {
      name: 'pic.jpg',
      directoryId: 'dir-1',
      updatedAt: base,
    })
    await createFile('v2', {
      name: 'pic.jpg',
      directoryId: 'dir-1',
      updatedAt: base + 100,
    })

    const dirs = await queryAllDirectoriesWithCounts(db())
    const photos = dirs.find((d) => d.name === 'Photos')
    expect(photos?.fileCount).toBe(1)
  })

  test('remote version without tag does NOT auto-inherit', async () => {
    await createFile('v1', { name: 'doc.txt', updatedAt: base })
    await addTagToFile(db(), 'v1', 'favorites')
    // v2 must have updatedAt higher than v1's post-tag updatedAt (Date.now())
    const futureTs = Date.now() + 1000
    await createFile('v2', { name: 'doc.txt', updatedAt: futureTs })

    const v2Tags = await queryTagsForFile(db(), 'v2')
    expect(v2Tags).toHaveLength(0)

    const v1Tags = await queryTagsForFile(db(), 'v1')
    const tagCount = await queryTagFileCount(db(), v1Tags[0].id)
    expect(tagCount).toBe(0)
  })
})

describe('current column maintenance', () => {
  test('deleting current version makes next-latest current', async () => {
    await createFile('v1', { name: 'doc.txt', updatedAt: base })
    await createFile('v2', { name: 'doc.txt', updatedAt: base + 100 })
    await createFile('v3', { name: 'doc.txt', updatedAt: base + 200 })

    expect(await queryLibraryFileCount(db())).toBe(1)
    const before = await queryFileRecordByName(db(), 'doc.txt')
    expect(before?.id).toBe('v3')

    await deleteFileRecordAndThumbnails(db(), 'v3')

    expect(await queryLibraryFileCount(db())).toBe(1)
    const after = await queryFileRecordByName(db(), 'doc.txt')
    expect(after?.id).toBe('v2')
  })

  test('deleting non-current version keeps current unchanged', async () => {
    await createFile('v1', { name: 'doc.txt', updatedAt: base })
    await createFile('v2', { name: 'doc.txt', updatedAt: base + 100 })

    await deleteFileRecordAndThumbnails(db(), 'v1')

    expect(await queryLibraryFileCount(db())).toBe(1)
    const current = await queryFileRecordByName(db(), 'doc.txt')
    expect(current?.id).toBe('v2')
  })

  test('bulk delete recalculates affected version groups', async () => {
    await createFile('a1', { name: 'a.txt', updatedAt: base })
    await createFile('a2', { name: 'a.txt', updatedAt: base + 100 })
    await createFile('b1', { name: 'b.txt', updatedAt: base })
    await createFile('b2', { name: 'b.txt', updatedAt: base + 100 })

    expect(await queryLibraryFileCount(db())).toBe(2)

    await deleteManyFileRecordsByIds(db(), ['a2', 'b2'])

    expect(await queryLibraryFileCount(db())).toBe(2)
    expect((await queryFileRecordByName(db(), 'a.txt'))?.id).toBe('a1')
    expect((await queryFileRecordByName(db(), 'b.txt'))?.id).toBe('b1')
  })

  test('trashing current version makes next-latest current', async () => {
    await createFile('v1', { name: 'doc.txt', updatedAt: base })
    await createFile('v2', { name: 'doc.txt', updatedAt: base + 100 })

    await trashFiles(db(), ['v2'])

    expect(await queryLibraryFileCount(db())).toBe(1)
    const current = await queryFileRecordByName(db(), 'doc.txt')
    expect(current?.id).toBe('v1')
  })

  test('restoring a version recalculates current correctly', async () => {
    await createFile('v1', { name: 'doc.txt', updatedAt: base })
    await createFile('v2', { name: 'doc.txt', updatedAt: base + 100 })

    await trashFiles(db(), ['v2'])
    expect((await queryFileRecordByName(db(), 'doc.txt'))?.id).toBe('v1')

    await restoreFiles(db(), ['v2'])
    expect(await queryLibraryFileCount(db())).toBe(1)
    expect((await queryFileRecordByName(db(), 'doc.txt'))?.id).toBe('v2')
  })

  test('partial restore: restoring one of three trashed versions makes it current', async () => {
    await createFile('v1', { name: 'doc.txt', updatedAt: base })
    await createFile('v2', { name: 'doc.txt', updatedAt: base + 100 })
    await createFile('v3', { name: 'doc.txt', updatedAt: base + 200 })

    await trashFiles(db(), ['v1', 'v2', 'v3'])
    expect(await queryLibraryFileCount(db())).toBe(0)

    await restoreFiles(db(), ['v1'])
    expect(await queryLibraryFileCount(db())).toBe(1)
    expect((await queryFileRecordByName(db(), 'doc.txt'))?.id).toBe('v1')
  })

  test('deleting last version in group leaves no current file', async () => {
    await createFile('v1', { name: 'doc.txt', updatedAt: base })
    await deleteFileRecordAndThumbnails(db(), 'v1')
    expect(await queryLibraryFileCount(db())).toBe(0)
  })

  test('insertManyFileRecords sets current correctly across version groups', async () => {
    await insertManyFileRecords(db(), [
      {
        id: 'a1',
        name: 'shared.txt',
        type: 'text/plain',
        kind: 'file',
        size: 100,
        hash: 'h-a1',
        createdAt: base,
        updatedAt: base,
        localId: null,
        addedAt: base,
        trashedAt: null,
        deletedAt: null,
      },
      {
        id: 'a2',
        name: 'shared.txt',
        type: 'text/plain',
        kind: 'file',
        size: 200,
        hash: 'h-a2',
        createdAt: base + 10,
        updatedAt: base + 100,
        localId: null,
        addedAt: base + 10,
        trashedAt: null,
        deletedAt: null,
      },
      {
        id: 'b1',
        name: 'unique.txt',
        type: 'text/plain',
        kind: 'file',
        size: 300,
        hash: 'h-b1',
        createdAt: base,
        updatedAt: base,
        localId: null,
        addedAt: base,
        trashedAt: null,
        deletedAt: null,
      },
    ])

    expect(await queryLibraryFileCount(db())).toBe(2)
    expect((await queryFileRecordByName(db(), 'shared.txt'))?.id).toBe('a2')
    expect((await queryFileRecordByName(db(), 'unique.txt'))?.id).toBe('b1')
  })
})

describe('move to folder and back moves all versions', () => {
  test('2 versions per folder, merge, verify current, move back', async () => {
    await createDirectory('dir-1', 'Folder1')
    await createDirectory('dir-2', 'Folder2')
    // Folder1 has a.txt v1 and v2
    await createFile('f1-v1', {
      name: 'a.txt',
      directoryId: 'dir-1',
      updatedAt: base,
    })
    await createFile('f1-v2', {
      name: 'a.txt',
      directoryId: 'dir-1',
      updatedAt: base + 100,
    })
    // Folder2 has a.txt v3 and v4
    await createFile('f2-v3', {
      name: 'a.txt',
      directoryId: 'dir-2',
      updatedAt: base + 200,
    })
    await createFile('f2-v4', {
      name: 'a.txt',
      directoryId: 'dir-2',
      updatedAt: base + 300,
    })

    // Each folder shows 1 file (latest version), library has 2
    expect(await queryDirectoryFileCount(db(), 'dir-1')).toBe(1)
    expect(await queryDirectoryFileCount(db(), 'dir-2')).toBe(1)
    expect(await queryLibraryFileCount(db())).toBe(2)

    // Move Folder1's "a.txt" (both versions) to Folder2 → merge into 4 versions
    await moveAllFileVersions(db(), 'a.txt', 'dir-1', 'dir-2')

    expect(await queryDirectoryFileCount(db(), 'dir-1')).toBe(0)
    expect(await queryDirectoryFileCount(db(), 'dir-2')).toBe(1)
    expect(await queryLibraryFileCount(db())).toBe(1)

    const merged = await queryFileVersions(db(), 'a.txt', 'dir-2')
    expect(merged).toHaveLength(4)
    // Moved versions get updatedAt=now (staggered), so f1-v2 is current
    expect(merged[0].id).toBe('f1-v2')

    // Move ALL 4 versions back to Folder1
    await moveAllFileVersions(db(), 'a.txt', 'dir-2', 'dir-1')

    expect(await queryDirectoryFileCount(db(), 'dir-1')).toBe(1)
    expect(await queryDirectoryFileCount(db(), 'dir-2')).toBe(0)
    expect(await queryLibraryFileCount(db())).toBe(1)

    const back = await queryFileVersions(db(), 'a.txt', 'dir-1')
    expect(back).toHaveLength(4)
    // All 4 versions are in Folder1 now, none left in Folder2
    const remaining = await queryFileVersions(db(), 'a.txt', 'dir-2')
    expect(remaining).toHaveLength(0)
  })
})

describe('trash file trashes all versions', () => {
  test('trashAllFileVersions removes all versions from library', async () => {
    await createFile('v1', { name: 'doc.txt', updatedAt: base })
    await createFile('v2', { name: 'doc.txt', updatedAt: base + 100 })
    await createFile('v3', { name: 'doc.txt', updatedAt: base + 200 })

    expect(await queryLibraryFileCount(db())).toBe(1)

    const ids = await trashAllFileVersions(db(), 'doc.txt', null)
    expect(ids).toHaveLength(3)
    expect(await queryLibraryFileCount(db())).toBe(0)

    // Restore all — v3 should be current again
    await restoreFiles(db(), ids)
    expect(await queryLibraryFileCount(db())).toBe(1)
    expect((await queryFileRecordByName(db(), 'doc.txt'))?.id).toBe('v3')
  })
})
