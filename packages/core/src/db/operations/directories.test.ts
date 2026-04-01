import {
  deleteDirectory,
  deleteDirectoryAndTrashFiles,
  getOrCreateDirectory,
  insertDirectory,
  moveFilesToDirectory,
  moveFileToDirectory,
  queryAllDirectoriesWithCounts,
  queryCountFilesWithDirectories,
  queryDirectoryNameForFile,
  renameDirectory,
  sanitizeDirectoryName,
  syncDirectoryFromMetadata,
} from './directories'
import { insertFileRecord, queryFileRecordById } from './files'
import { db, setupTestDb, teardownTestDb } from './test-setup'

async function createTestFile(id: string) {
  await insertFileRecord(db(), {
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

describe('sanitizeDirectoryName', () => {
  it('strips forward slashes', () => {
    expect(sanitizeDirectoryName('a/b/c')).toBe('abc')
  })

  it('strips backslashes', () => {
    expect(sanitizeDirectoryName('a\\b')).toBe('ab')
  })

  it('strips control characters', () => {
    expect(sanitizeDirectoryName('hello\x00world\x1f')).toBe('helloworld')
  })

  it('strips DEL character', () => {
    expect(sanitizeDirectoryName('hello\x7fworld')).toBe('helloworld')
  })

  it('rejects . as empty', () => {
    expect(sanitizeDirectoryName('.')).toBe('')
  })

  it('rejects .. as empty', () => {
    expect(sanitizeDirectoryName('..')).toBe('')
  })

  it('rejects ... as empty', () => {
    expect(sanitizeDirectoryName('...')).toBe('')
  })

  it('trims whitespace', () => {
    expect(sanitizeDirectoryName('  hello  ')).toBe('hello')
  })

  it('truncates to 255 characters', () => {
    const long = 'a'.repeat(300)
    expect(sanitizeDirectoryName(long)).toBe('a'.repeat(255))
  })

  it('rejects ... as empty', () => {
    expect(sanitizeDirectoryName('...')).toBe('')
  })

  it('preserves valid names', () => {
    expect(sanitizeDirectoryName('Photos 2024')).toBe('Photos 2024')
  })

  it('returns empty for whitespace-only input', () => {
    expect(sanitizeDirectoryName('   ')).toBe('')
  })
})

describe('insertDirectory', () => {
  it('creates a directory with correct fields', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    expect(dir.id).toBeDefined()
    expect(dir.name).toBe('Photos')
    expect(dir.createdAt).toBeGreaterThan(0)
  })

  it('trims the name', async () => {
    const dir = await insertDirectory(db(), '  Photos  ')
    expect(dir.name).toBe('Photos')
  })

  it('throws on empty name', async () => {
    await expect(insertDirectory(db(), '')).rejects.toThrow(
      'Folder name cannot be empty',
    )
  })

  it('throws on duplicate name (case-insensitive)', async () => {
    await insertDirectory(db(), 'Photos')
    await expect(insertDirectory(db(), 'photos')).rejects.toThrow(
      'already exists',
    )
  })

  it('sanitizes slashes from the name', async () => {
    const dir = await insertDirectory(db(), 'my/folder\\name')
    expect(dir.name).toBe('myfoldername')
  })
})

describe('getOrCreateDirectory', () => {
  it('returns existing directory (case-insensitive)', async () => {
    const dir1 = await getOrCreateDirectory(db(), 'Photos')
    const dir2 = await getOrCreateDirectory(db(), 'photos')
    expect(dir2.id).toBe(dir1.id)
    expect(dir2.name).toBe('Photos')
  })

  it('creates a new directory if not found', async () => {
    const dir = await getOrCreateDirectory(db(), 'Videos')
    expect(dir.id).toBeDefined()
    expect(dir.name).toBe('Videos')
  })
})

describe('queryAllDirectoriesWithCounts', () => {
  it('returns directories with file counts', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f2', dir.id)

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs).toHaveLength(1)
    expect(dirs[0].name).toBe('Photos')
    expect(dirs[0].fileCount).toBe(2)
  })

  it('returns 0 for empty directories', async () => {
    await insertDirectory(db(), 'Empty')
    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs).toHaveLength(1)
    expect(dirs[0].fileCount).toBe(0)
  })

  it('excludes trashed files from count', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f2', dir.id)

    await db().runAsync(
      'UPDATE files SET trashedAt = ? WHERE id = ?',
      Date.now(),
      'f2',
    )

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs[0].fileCount).toBe(1)
  })
})

describe('deleteDirectory', () => {
  it('unlinks files and deletes dir row', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', dir.id)

    await deleteDirectory(db(), dir.id)

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs).toHaveLength(0)

    const file = await queryFileRecordById(db(), 'f1')
    expect(file).not.toBeNull()
  })

  it('works on empty directory', async () => {
    const dir = await insertDirectory(db(), 'Empty')
    await deleteDirectory(db(), dir.id)

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs).toHaveLength(0)
  })
})

describe('deleteDirectoryAndTrashFiles', () => {
  it('trashes active files and deletes directory', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f2', dir.id)

    const trashedIds = await deleteDirectoryAndTrashFiles(db(), dir.id)
    expect(trashedIds).toContain('f1')
    expect(trashedIds).toContain('f2')

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs).toHaveLength(0)

    const f1 = await queryFileRecordById(db(), 'f1')
    expect(f1!.trashedAt).not.toBeNull()
    const f2 = await queryFileRecordById(db(), 'f2')
    expect(f2!.trashedAt).not.toBeNull()
  })

  it('skips already-trashed files', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f2', dir.id)

    await db().runAsync(
      'UPDATE files SET trashedAt = ? WHERE id = ?',
      Date.now(),
      'f2',
    )

    const trashedIds = await deleteDirectoryAndTrashFiles(db(), dir.id)
    expect(trashedIds).toEqual(['f1'])
  })

  it('returns empty array for empty directory', async () => {
    const dir = await insertDirectory(db(), 'Empty')
    const trashedIds = await deleteDirectoryAndTrashFiles(db(), dir.id)
    expect(trashedIds).toEqual([])
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

describe('renameDirectory', () => {
  it('renames a directory', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await renameDirectory(db(), dir.id, 'Pictures')

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs[0].name).toBe('Pictures')
  })

  it('throws on empty name', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await expect(renameDirectory(db(), dir.id, '')).rejects.toThrow(
      'Folder name cannot be empty',
    )
  })

  it('throws on duplicate name', async () => {
    const dir1 = await insertDirectory(db(), 'Photos')
    await insertDirectory(db(), 'Videos')
    await expect(renameDirectory(db(), dir1.id, 'Videos')).rejects.toThrow(
      'already exists',
    )
  })

  it('applies sanitization', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await renameDirectory(db(), dir.id, '  New/Name  ')

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs[0].name).toBe('NewName')
  })

  it('bumps updatedAt on files in the directory', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', dir.id)

    const before = (await queryFileRecordById(db(), 'f1'))!.updatedAt

    await new Promise((r) => setTimeout(r, 10))
    await renameDirectory(db(), dir.id, 'Pictures')

    const after = (await queryFileRecordById(db(), 'f1'))!.updatedAt
    expect(after).toBeGreaterThan(before)
  })
})

describe('moveFileToDirectory', () => {
  it('moves a file to a directory', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', dir.id)

    const name = await queryDirectoryNameForFile(db(), 'f1')
    expect(name).toBe('Photos')
  })

  it('moves a file out of a directory with null', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', dir.id)
    await moveFileToDirectory(db(), 'f1', null)

    const name = await queryDirectoryNameForFile(db(), 'f1')
    expect(name).toBeUndefined()
  })

  it('bumps updatedAt', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')

    await new Promise((r) => setTimeout(r, 10))
    await moveFileToDirectory(db(), 'f1', dir.id)

    const file = await queryFileRecordById(db(), 'f1')
    expect(file!.updatedAt).toBeGreaterThan(1000)
  })
})

describe('moveFilesToDirectory', () => {
  it('moves multiple files to a directory', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')
    await moveFilesToDirectory(db(), ['f1', 'f2'], dir.id)

    const name1 = await queryDirectoryNameForFile(db(), 'f1')
    const name2 = await queryDirectoryNameForFile(db(), 'f2')
    expect(name1).toBe('Photos')
    expect(name2).toBe('Photos')
  })

  it('handles empty array', async () => {
    await expect(moveFilesToDirectory(db(), [], null)).resolves.toBeUndefined()
  })
})

describe('syncDirectoryFromMetadata', () => {
  it('sets directory from name', async () => {
    await createTestFile('f1')
    await syncDirectoryFromMetadata(db(), 'f1', 'Photos')

    const name = await queryDirectoryNameForFile(db(), 'f1')
    expect(name).toBe('Photos')
  })

  it('preserves when directoryName is undefined', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', dir.id)

    await syncDirectoryFromMetadata(db(), 'f1', undefined)

    const name = await queryDirectoryNameForFile(db(), 'f1')
    expect(name).toBe('Photos')
  })

  it('reuses existing directory (case-insensitive)', async () => {
    await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await createTestFile('f2')

    await syncDirectoryFromMetadata(db(), 'f1', 'Photos')
    await syncDirectoryFromMetadata(db(), 'f2', 'photos')

    const dirs = await queryAllDirectoriesWithCounts(db())
    expect(dirs).toHaveLength(1)
    expect(dirs[0].fileCount).toBe(2)
  })
})

describe('queryDirectoryNameForFile', () => {
  it('returns the directory name', async () => {
    const dir = await insertDirectory(db(), 'Photos')
    await createTestFile('f1')
    await moveFileToDirectory(db(), 'f1', dir.id)

    const name = await queryDirectoryNameForFile(db(), 'f1')
    expect(name).toBe('Photos')
  })

  it('returns undefined when file has no directory', async () => {
    await createTestFile('f1')
    const name = await queryDirectoryNameForFile(db(), 'f1')
    expect(name).toBeUndefined()
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
    const names = dirs.map((d) => d.name)
    expect(names).toEqual([
      'Folder 1',
      'Folder 2',
      'Folder 3',
      'Folder 10',
      'Folder 20',
    ])
  })
})
