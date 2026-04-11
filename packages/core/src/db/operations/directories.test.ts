import {
  deleteDirectory,
  deleteDirectoryAndTrashFiles,
  directoryBreadcrumbs,
  directoryDisplayName,
  directoryParentPath,
  escapeLikePattern,
  getOrCreateDirectory,
  getOrCreateDirectoryAtPath,
  insertDirectory,
  moveDirectory,
  moveFilesToDirectory,
  moveFileToDirectory,
  queryAllDirectoriesWithCounts,
  queryCountFilesWithDirectories,
  queryDirectoryById,
  queryDirectoryChildren,
  queryDirectoryPathForFile,
  renameDirectory,
  sanitizeDirectoryPath,
  sanitizeDirectorySegment,
  syncDirectoryFromMetadata,
} from './directories'
import { insertFile, queryFileById } from './files'
import { db, setupTestDb, teardownTestDb } from './test-setup'

async function createTestFile(id: string) {
  await insertFile(db(), {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    kind: 'file',
    size: 100,
    hash: `hash-${id}`,
    createdAt: 1000,
    updatedAt: 1000,
    localId: null,
    addedAt: 1000,
    trashedAt: null,
    deletedAt: null,
  })
}

beforeEach(setupTestDb)
afterEach(teardownTestDb)

describe('directoryDisplayName', () => {
  it('returns full string for root', () => {
    expect(directoryDisplayName('Photos')).toBe('Photos')
  })

  it('returns leaf segment for nested', () => {
    expect(directoryDisplayName('Photos/Vacation')).toBe('Vacation')
  })

  it('returns leaf segment for deep nesting', () => {
    expect(directoryDisplayName('A/B/C/D')).toBe('D')
  })
})

describe('directoryParentPath', () => {
  it('returns null for root', () => {
    expect(directoryParentPath('Photos')).toBeNull()
  })

  it('returns parent for nested', () => {
    expect(directoryParentPath('Photos/Vacation')).toBe('Photos')
  })

  it('returns parent for deep nesting', () => {
    expect(directoryParentPath('A/B/C/D')).toBe('A/B/C')
  })
})

describe('directoryBreadcrumbs', () => {
  it('returns single entry for root', () => {
    expect(directoryBreadcrumbs('Photos')).toEqual([{ segment: 'Photos', path: 'Photos' }])
  })

  it('returns entries with cumulative paths', () => {
    expect(directoryBreadcrumbs('Photos/Vacation/2025')).toEqual([
      { segment: 'Photos', path: 'Photos' },
      { segment: 'Vacation', path: 'Photos/Vacation' },
      { segment: '2025', path: 'Photos/Vacation/2025' },
    ])
  })
})

describe('escapeLikePattern', () => {
  it('returns normal strings unchanged', () => {
    expect(escapeLikePattern('normal')).toBe('normal')
  })

  it('escapes % and _', () => {
    expect(escapeLikePattern('50%_off')).toBe('50\\%\\_off')
  })

  it('escapes backslash', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b')
  })
})

describe('sanitizeDirectorySegment', () => {
  it('strips forward slashes', () => {
    expect(sanitizeDirectorySegment('a/b/c')).toBe('abc')
  })

  it('strips backslashes', () => {
    expect(sanitizeDirectorySegment('a\\b')).toBe('ab')
  })

  it('strips control characters', () => {
    expect(sanitizeDirectorySegment('hello\x00world\x1f')).toBe('helloworld')
  })

  it('strips DEL character', () => {
    expect(sanitizeDirectorySegment('hello\x7fworld')).toBe('helloworld')
  })

  it('rejects . as empty', () => {
    expect(sanitizeDirectorySegment('.')).toBe('')
  })

  it('rejects .. as empty', () => {
    expect(sanitizeDirectorySegment('..')).toBe('')
  })

  it('trims whitespace', () => {
    expect(sanitizeDirectorySegment('  hello  ')).toBe('hello')
  })

  it('truncates to 255 characters', () => {
    const long = 'a'.repeat(300)
    expect(sanitizeDirectorySegment(long)).toBe('a'.repeat(255))
  })

  it('preserves valid names', () => {
    expect(sanitizeDirectorySegment('Photos 2024')).toBe('Photos 2024')
  })

  it('returns empty for whitespace-only input', () => {
    expect(sanitizeDirectorySegment('   ')).toBe('')
  })
})

describe('sanitizeDirectoryPath', () => {
  it('sanitizes each segment and joins with /', () => {
    expect(sanitizeDirectoryPath('Photos/Vacation/2025')).toBe('Photos/Vacation/2025')
  })

  it('removes empty segments', () => {
    expect(sanitizeDirectoryPath('Photos//Vacation')).toBe('Photos/Vacation')
  })

  it('strips bad characters from each segment', () => {
    expect(sanitizeDirectoryPath('Pho\x00tos/Va\\ca\x7ftion')).toBe('Photos/Vacation')
  })

  it('returns single segment for flat name', () => {
    expect(sanitizeDirectoryPath('Photos')).toBe('Photos')
  })

  it('returns empty for all-dots segments', () => {
    expect(sanitizeDirectoryPath('../..')).toBe('')
  })
})

describe('insertDirectory', () => {
  it('creates a root directory', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    expect(dir.id).toBeDefined()
    expect(dir.path).toBe('Photos')
    expect(dir.name).toBe('Photos')
    expect(dir.createdAt).toBeGreaterThan(0)
  })

  it('creates a nested directory', async () => {
    await insertDirectory(db(), 'Photos')
    const dir = await insertDirectory(db(), 'Vacation', 'Photos')
    expect(dir.path).toBe('Photos/Vacation')
    expect(dir.name).toBe('Vacation')
  })

  it('creates a deeply nested directory', async () => {
    await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'Vacation', 'Photos')
    const dir = await insertDirectory(db(), '2025', 'Photos/Vacation')
    expect(dir.path).toBe('Photos/Vacation/2025')
  })

  it('trims the name', async () => {
    const dir = await insertDirectory(db(), '  Photos  ')
    expect(dir.name).toBe('Photos')
  })

  it('throws on empty name', async () => {
    await expect(insertDirectory(db(), '')).rejects.toThrow('Folder name cannot be empty')
  })

  it('throws on duplicate path', async () => {
    await insertDirectory(db(), 'Photos')
    await expect(insertDirectory(db(), 'Photos')).rejects.toThrow('already exists')
  })

  it('allows directories with different casing', async () => {
    const dir1 = await insertDirectory(db(), 'Photos')
    const dir2 = await insertDirectory(db(), 'photos')
    expect(dir1.id).not.toBe(dir2.id)
    expect(dir1.path).toBe('Photos')
    expect(dir2.path).toBe('photos')
  })

  it('allows same leaf name under different parents', async () => {
    await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'Videos')
    const a = await insertDirectory(db(), 'Vacation', 'Photos')
    const b = await insertDirectory(db(), 'Vacation', 'Videos')
    expect(a.path).toBe('Photos/Vacation')
    expect(b.path).toBe('Videos/Vacation')
  })

  it('sanitizes slashes from the name', async () => {
    const dir = await insertDirectory(db(), 'my/folder\\name')
    expect(dir.name).toBe('myfoldername')
  })
})

describe('getOrCreateDirectory', () => {
  it('creates separate directory for different casing', async () => {
    const dir1 = await getOrCreateDirectory(db(), 'Photos')
    const dir2 = await getOrCreateDirectory(db(), 'photos')
    expect(dir1.id).not.toBe(dir2.id)
  })

  it('creates a new directory if not found', async () => {
    const dir = await getOrCreateDirectory(db(), 'Videos')
    expect(dir.id).toBeDefined()
    expect(dir.name).toBe('Videos')
  })

  it('creates nested, returns if already exists', async () => {
    await getOrCreateDirectory(db(), 'Photos')
    const dir1 = await getOrCreateDirectory(db(), 'Vacation', 'Photos')
    const dir2 = await getOrCreateDirectory(db(), 'Vacation', 'Photos')
    expect(dir1.id).toBe(dir2.id)
    expect(dir1.path).toBe('Photos/Vacation')
  })
})

describe('getOrCreateDirectoryAtPath', () => {
  it('creates single directory', async () => {
    const dir = await getOrCreateDirectoryAtPath(db(), 'Photos')
    expect(dir.path).toBe('Photos')
    expect(dir.name).toBe('Photos')
  })

  it('creates intermediate directories', async () => {
    const dir = await getOrCreateDirectoryAtPath(db(), 'Photos/Vacation')
    expect(dir.path).toBe('Photos/Vacation')
    expect(dir.name).toBe('Vacation')

    const all = await queryAllDirectoriesWithCounts(db())
    expect(all).toHaveLength(2)
  })

  it('creates 3 dirs for deep path', async () => {
    const dir = await getOrCreateDirectoryAtPath(db(), 'Photos/Vacation/2025')
    expect(dir.path).toBe('Photos/Vacation/2025')

    const all = await queryAllDirectoriesWithCounts(db())
    expect(all).toHaveLength(3)
  })

  it('reuses existing intermediate dirs', async () => {
    const existing = await getOrCreateDirectoryAtPath(db(), 'Photos')
    const dir = await getOrCreateDirectoryAtPath(db(), 'Photos/Vacation')
    expect(dir.path).toBe('Photos/Vacation')

    const photos = await queryDirectoryById(db(), existing.id)
    expect(photos).not.toBeNull()

    const all = await queryAllDirectoriesWithCounts(db())
    expect(all).toHaveLength(2)
  })
})

describe('queryDirectoryChildren', () => {
  it('returns root children', async () => {
    await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'Videos')
    await insertDirectory(db(), 'Vacation', 'Photos')

    const roots = await queryDirectoryChildren(db(), null)
    expect(roots).toHaveLength(2)
    expect(roots.map((d) => d.name).sort()).toEqual(['Photos', 'Videos'])
  })

  it('returns nested children', async () => {
    await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'Vacation', 'Photos')
    await insertDirectory(db(), 'Work', 'Photos')
    await insertDirectory(db(), '2025', 'Photos/Vacation')

    const children = await queryDirectoryChildren(db(), 'Photos')
    expect(children).toHaveLength(2)
    expect(children.map((d) => d.name).sort()).toEqual(['Vacation', 'Work'])
  })

  it('includes fileCount per child', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f2', dir.id)

    const roots = await queryDirectoryChildren(db(), null)
    expect(roots[0].fileCount).toBe(2)
  })

  it('includes subdirectoryCount per child', async () => {
    await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'Vacation', 'Photos')
    await insertDirectory(db(), 'Work', 'Photos')

    const roots = await queryDirectoryChildren(db(), null)
    const photos = roots.find((d) => d.name === 'Photos')
    expect(photos!.subdirectoryCount).toBe(2)
  })

  it('returns empty array for no children', async () => {
    await insertDirectory(db(), 'Photos')
    const children = await queryDirectoryChildren(db(), 'Photos')
    expect(children).toEqual([])
  })

  it('handles directory names with LIKE special characters', async () => {
    await insertDirectory(db(), 'a_b')
    await insertDirectory(db(), 'axb')
    await insertDirectory(db(), 'child', 'a_b')

    const roots = await queryDirectoryChildren(db(), null)
    const aUndB = roots.find((d) => d.name === 'a_b')!
    const axb = roots.find((d) => d.name === 'axb')!
    expect(aUndB.subdirectoryCount).toBe(1)
    expect(axb.subdirectoryCount).toBe(0)
  })

  it('handles directory names with percent sign', async () => {
    await insertDirectory(db(), '50% off')
    await insertDirectory(db(), 'child', '50% off')

    const roots = await queryDirectoryChildren(db(), null)
    expect(roots).toHaveLength(1)
    expect(roots[0].subdirectoryCount).toBe(1)

    const children = await queryDirectoryChildren(db(), '50% off')
    expect(children).toHaveLength(1)
    expect(children[0].name).toBe('child')
  })
})

describe('queryAllDirectoriesWithCounts', () => {
  it('returns all dirs with counts', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'Vacation', 'Photos')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', dir.id)

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs).toHaveLength(2)
    const photos = dirs.find((d) => d.path === 'Photos')!
    expect(photos.fileCount).toBe(1)
    expect(photos.subdirectoryCount).toBe(1)
  })

  it('returns 0 for empty directories', async () => {
    await insertDirectory(db(), 'Empty')
    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs).toHaveLength(1)
    expect(dirs[0].fileCount).toBe(0)
    expect(dirs[0].subdirectoryCount).toBe(0)
  })

  it('excludes trashed files from count', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f2', dir.id)

    await db().runAsync('UPDATE files SET trashedAt = ? WHERE id = ?', Date.now(), 'f2')

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs[0].fileCount).toBe(1)
  })
})

describe('renameDirectory', () => {
  it('renames leaf segment of root dir and returns updated directory', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    const updated = await renameDirectory(db(), dir.id, 'Images')

    expect(updated.id).toBe(dir.id)
    expect(updated.path).toBe('Images')
    expect(updated.name).toBe('Images')

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs[0].path).toBe('Images')
  })

  it('updates all descendant paths', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'Vacation', 'Photos')
    await insertDirectory(db(), '2025', 'Photos/Vacation')

    await renameDirectory(db(), dir.id, 'Images')

    const dirs = await queryAllDirectoriesWithCounts(db())
    const paths = dirs.map((d) => d.path).sort()
    expect(paths).toEqual(['Images', 'Images/Vacation', 'Images/Vacation/2025'])
  })

  it('renames nested dir and updates descendants', async () => {
    await insertDirectory(db(), 'Photos')
    const vacation = await insertDirectory(db(), 'Vacation', 'Photos')
    await insertDirectory(db(), '2025', 'Photos/Vacation')

    await renameDirectory(db(), vacation.id, 'Trip')

    const dirs = await queryAllDirectoriesWithCounts(db())
    const paths = dirs.map((d) => d.path).sort()
    expect(paths).toEqual(['Photos', 'Photos/Trip', 'Photos/Trip/2025'])
  })

  it('throws on empty name', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await expect(renameDirectory(db(), dir.id, '')).rejects.toThrow('Folder name cannot be empty')
  })

  it('throws on duplicate name', async () => {
    const dir1 = await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'Videos')
    await expect(renameDirectory(db(), dir1.id, 'Videos')).rejects.toThrow('already exists')
  })

  it('applies sanitization', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await renameDirectory(db(), dir.id, '  New/Name  ')

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs[0].name).toBe('NewName')
  })

  it('bumps updatedAt on files in renamed dir and descendants', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    const vacation = await insertDirectory(db(), 'Vacation', 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f2', vacation.id)

    const before1 = (await queryFileById(db(), 'f1'))!.updatedAt
    const before2 = (await queryFileById(db(), 'f2'))!.updatedAt

    await new Promise((r) => setTimeout(r, 10))
    await renameDirectory(db(), dir.id, 'Images')

    const after1 = (await queryFileById(db(), 'f1'))!.updatedAt
    const after2 = (await queryFileById(db(), 'f2'))!.updatedAt
    expect(after1).toBeGreaterThan(before1)
    expect(after2).toBeGreaterThan(before2)
  })
})

describe('deleteDirectory', () => {
  it('deletes directory and all descendants', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'A', 'Photos')
    await insertDirectory(db(), 'B', 'Photos/A')

    await deleteDirectory(db(), dir.id)

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs).toHaveLength(0)
  })

  it('unlinks files from entire subtree', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    const sub = await insertDirectory(db(), 'A', 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f2', sub.id)

    await deleteDirectory(db(), dir.id)

    const path1 = await queryDirectoryPathForFile(db(), 'f1')
    expect(path1).toBeUndefined()
    const path2 = await queryDirectoryPathForFile(db(), 'f2')
    expect(path2).toBeUndefined()
  })

  it('does not affect sibling directories or their files', async () => {
    const photos = await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'Vacation', 'Photos')
    await insertDirectory(db(), 'Videos')
    const work = await insertDirectory(db(), 'Work', 'Videos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFileToDirectory(db(), 'f1', photos.id)
    await moveFileToDirectory(db(), 'f2', work.id)

    await deleteDirectory(db(), photos.id)

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs.map((d) => d.path).sort()).toEqual(['Videos', 'Videos/Work'])

    const path2 = await queryDirectoryPathForFile(db(), 'f2')
    expect(path2).toBe('Videos/Work')
  })

  it('works on empty directory', async () => {
    const dir = await insertDirectory(db(), 'Empty')
    await deleteDirectory(db(), dir.id)

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs).toHaveLength(0)
  })
})

describe('deleteDirectoryAndTrashFiles', () => {
  it('trashes files from all levels and deletes subtree', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    const vacation = await insertDirectory(db(), 'Vacation', 'Photos')
    const deep = await insertDirectory(db(), '2025', 'Photos/Vacation')
    await createTestFile('f1')
    await createTestFile('f2')
    await createTestFile('f3')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f2', vacation.id)
    await moveFileToDirectory(db(), 'f3', deep.id)

    const trashedCount = await deleteDirectoryAndTrashFiles(db(), dir.id)
    expect(trashedCount).toBe(3)

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs).toHaveLength(0)

    const f1 = await queryFileById(db(), 'f1')
    expect(f1!.trashedAt).not.toBeNull()
    const f2 = await queryFileById(db(), 'f2')
    expect(f2!.trashedAt).not.toBeNull()
    const f3 = await queryFileById(db(), 'f3')
    expect(f3!.trashedAt).not.toBeNull()
  })

  it('skips already-trashed files', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f2', dir.id)

    await db().runAsync('UPDATE files SET trashedAt = ? WHERE id = ?', Date.now(), 'f2')

    const trashedCount = await deleteDirectoryAndTrashFiles(db(), dir.id)
    expect(trashedCount).toBe(1)
  })

  it('does not affect sibling directories or their files', async () => {
    const photos = await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'Vacation', 'Photos')
    await insertDirectory(db(), 'Videos')
    const work = await insertDirectory(db(), 'Work', 'Videos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFileToDirectory(db(), 'f1', photos.id)
    await moveFileToDirectory(db(), 'f2', work.id)

    await deleteDirectoryAndTrashFiles(db(), photos.id)

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs.map((d) => d.path).sort()).toEqual(['Videos', 'Videos/Work'])

    const f2 = await queryFileById(db(), 'f2')
    expect(f2!.trashedAt).toBeNull()

    const path2 = await queryDirectoryPathForFile(db(), 'f2')
    expect(path2).toBe('Videos/Work')
  })

  it('returns 0 for empty directory', async () => {
    const dir = await insertDirectory(db(), 'Empty')
    const trashedCount = await deleteDirectoryAndTrashFiles(db(), dir.id)
    expect(trashedCount).toBe(0)
  })
})

describe('moveDirectory', () => {
  it('moves dir under new parent', async () => {
    await insertDirectory(db(), 'Work')
    const reports = await insertDirectory(db(), 'Reports', 'Work')
    await insertDirectory(db(), 'Archive')

    await moveDirectory(db(), reports.id, 'Archive')

    const dirs = await queryAllDirectoriesWithCounts(db())
    const paths = dirs.map((d) => d.path).sort()
    expect(paths).toContain('Archive/Reports')
    expect(paths).not.toContain('Work/Reports')
  })

  it('moves dir to root', async () => {
    await insertDirectory(db(), 'Photos')
    const vacation = await insertDirectory(db(), 'Vacation', 'Photos')

    await moveDirectory(db(), vacation.id, null)

    const dirs = await queryAllDirectoriesWithCounts(db())
    const paths = dirs.map((d) => d.path).sort()
    expect(paths).toEqual(['Photos', 'Vacation'])
  })

  it('updates all descendant paths', async () => {
    await insertDirectory(db(), 'Work')
    const reports = await insertDirectory(db(), 'Reports', 'Work')
    await insertDirectory(db(), 'Q1', 'Work/Reports')
    await insertDirectory(db(), 'Archive')

    await moveDirectory(db(), reports.id, 'Archive')

    const dirs = await queryAllDirectoriesWithCounts(db())
    const paths = dirs.map((d) => d.path).sort()
    expect(paths).toContain('Archive/Reports')
    expect(paths).toContain('Archive/Reports/Q1')
  })

  it('rejects circular move', async () => {
    const photos = await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'Vacation', 'Photos')

    await expect(moveDirectory(db(), photos.id, 'Photos/Vacation')).rejects.toThrow(
      'Cannot move a folder into itself',
    )
  })

  it('rejects move when sibling name conflicts', async () => {
    await insertDirectory(db(), 'Photos')
    const vacation = await insertDirectory(db(), 'Vacation', 'Photos')
    await insertDirectory(db(), 'Vacation')

    await expect(moveDirectory(db(), vacation.id, null)).rejects.toThrow(
      'already exists at destination',
    )
  })

  it('preserves file assignments', async () => {
    await insertDirectory(db(), 'Work')
    const reports = await insertDirectory(db(), 'Reports', 'Work')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', reports.id)
    await insertDirectory(db(), 'Archive')

    await moveDirectory(db(), reports.id, 'Archive')

    const path = await queryDirectoryPathForFile(db(), 'f1')
    expect(path).toBe('Archive/Reports')
  })

  it('bumps updatedAt on files in moved dir and descendants', async () => {
    await insertDirectory(db(), 'Work')
    const reports = await insertDirectory(db(), 'Reports', 'Work')
    const q1 = await insertDirectory(db(), 'Q1', 'Work/Reports')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFileToDirectory(db(), 'f1', reports.id)
    await moveFileToDirectory(db(), 'f2', q1.id)
    await insertDirectory(db(), 'Archive')

    const before1 = (await queryFileById(db(), 'f1'))!.updatedAt
    const before2 = (await queryFileById(db(), 'f2'))!.updatedAt

    await new Promise((r) => setTimeout(r, 10))
    await moveDirectory(db(), reports.id, 'Archive')

    const after1 = (await queryFileById(db(), 'f1'))!.updatedAt
    const after2 = (await queryFileById(db(), 'f2'))!.updatedAt
    expect(after1).toBeGreaterThan(before1)
    expect(after2).toBeGreaterThan(before2)
  })
})

describe('queryCountFilesWithDirectories', () => {
  it('counts files that have a directoryId', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')
    await createTestFile('f3')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f2', dir.id)

    const count = await queryCountFilesWithDirectories(db(), ['f1', 'f2', 'f3'])
    expect(count).toBe(2)
  })

  it('returns 0 for empty array', async () => {
    const count = await queryCountFilesWithDirectories(db(), [])
    expect(count).toBe(0)
  })
})

describe('syncDirectoryFromMetadata', () => {
  it('creates root dir and assigns file', async () => {
    await createTestFile('f1')
    await syncDirectoryFromMetadata(db(), 'f1', 'Photos')

    const path = await queryDirectoryPathForFile(db(), 'f1')
    expect(path).toBe('Photos')
  })

  it('creates intermediate dirs for nested path', async () => {
    await createTestFile('f1')
    await syncDirectoryFromMetadata(db(), 'f1', 'Photos/Vacation')

    const path = await queryDirectoryPathForFile(db(), 'f1')
    expect(path).toBe('Photos/Vacation')

    const all = await queryAllDirectoriesWithCounts(db())
    expect(all).toHaveLength(2)
  })

  it('creates 3 dirs for deep path', async () => {
    await createTestFile('f1')
    await syncDirectoryFromMetadata(db(), 'f1', 'Photos/Vacation/2025')

    const path = await queryDirectoryPathForFile(db(), 'f1')
    expect(path).toBe('Photos/Vacation/2025')

    const all = await queryAllDirectoriesWithCounts(db())
    expect(all).toHaveLength(3)
  })

  it('preserves when path is undefined', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', dir.id)

    await syncDirectoryFromMetadata(db(), 'f1', undefined)

    const path = await queryDirectoryPathForFile(db(), 'f1')
    expect(path).toBe('Photos')
  })

  it('creates separate directories for different casing', async () => {
    await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')

    await syncDirectoryFromMetadata(db(), 'f1', 'Photos')
    await syncDirectoryFromMetadata(db(), 'f2', 'photos')

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs).toHaveLength(2)
  })

  it('two files synced to same nested path share dir', async () => {
    await createTestFile('f1')
    await createTestFile('f2')

    await syncDirectoryFromMetadata(db(), 'f1', 'Photos/Vacation')
    await syncDirectoryFromMetadata(db(), 'f2', 'Photos/Vacation')

    const dirs = await queryAllDirectoriesWithCounts(db())
    const vacation = dirs.find((d) => d.path === 'Photos/Vacation')!
    expect(vacation.fileCount).toBe(2)
  })
})

describe('queryDirectoryPathForFile', () => {
  it('returns path for file in root dir', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', dir.id)

    const path = await queryDirectoryPathForFile(db(), 'f1')
    expect(path).toBe('Photos')
  })

  it('returns path for file in nested dir', async () => {
    await insertDirectory(db(), 'Photos')
    const vacation = await insertDirectory(db(), 'Vacation', 'Photos')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', vacation.id)

    const path = await queryDirectoryPathForFile(db(), 'f1')
    expect(path).toBe('Photos/Vacation')
  })

  it('returns undefined when file has no directory', async () => {
    await createTestFile('f1')
    const path = await queryDirectoryPathForFile(db(), 'f1')
    expect(path).toBeUndefined()
  })
})

describe('moveFileToDirectory', () => {
  it('moves a file to a nested directory', async () => {
    await insertDirectory(db(), 'Photos')
    const vacation = await insertDirectory(db(), 'Vacation', 'Photos')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', vacation.id)

    const path = await queryDirectoryPathForFile(db(), 'f1')
    expect(path).toBe('Photos/Vacation')
  })

  it('moves a file out of a directory with null', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f1', null)

    const path = await queryDirectoryPathForFile(db(), 'f1')
    expect(path).toBeUndefined()
  })

  it('bumps updatedAt', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')

    await new Promise((r) => setTimeout(r, 10))
    await moveFileToDirectory(db(), 'f1', dir.id)

    const file = await queryFileById(db(), 'f1')
    expect(file!.updatedAt).toBeGreaterThan(1000)
  })
})

describe('moveFilesToDirectory', () => {
  it('moves multiple files to a nested directory', async () => {
    await insertDirectory(db(), 'Photos')
    const vacation = await insertDirectory(db(), 'Vacation', 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFilesToDirectory(db(), ['f1', 'f2'], vacation.id)

    const path1 = await queryDirectoryPathForFile(db(), 'f1')
    const path2 = await queryDirectoryPathForFile(db(), 'f2')
    expect(path1).toBe('Photos/Vacation')
    expect(path2).toBe('Photos/Vacation')
  })

  it('handles empty array', async () => {
    await expect(moveFilesToDirectory(db(), [], null)).resolves.toBeUndefined()
  })
})

describe('natural sort order', () => {
  it('sorts directories in natural numeric order', async () => {
    await insertDirectory(db(), 'Folder 10')
    await insertDirectory(db(), 'Folder 2')
    await insertDirectory(db(), 'Folder 1')
    await insertDirectory(db(), 'Folder 20')
    await insertDirectory(db(), 'Folder 3')

    const dirs = await queryAllDirectoriesWithCounts(db())
    const names = dirs.map((d) => d.path)
    expect(names).toEqual(['Folder 1', 'Folder 2', 'Folder 3', 'Folder 10', 'Folder 20'])
  })
})
