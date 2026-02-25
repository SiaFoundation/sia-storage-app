import { initializeDB, resetDb } from '../db'
import { trashFiles } from '../lib/deleteFile'
import {
  createDirectory,
  deleteDirectory,
  deleteDirectoryAndTrashFiles,
  getOrCreateDirectory,
  moveFilesToDirectory,
  moveFileToDirectory,
  readAllDirectoriesWithCounts,
  readDirectoryNameForFile,
  renameDirectory,
  sanitizeDirectoryName,
  syncDirectoryFromMetadata,
} from './directories'
import { createFileRecord, readFileRecord } from './files'

jest.mock('../lib/deleteFile', () => ({
  trashFiles: jest.fn(),
}))

jest.mock('./librarySwr', () => ({
  libraryStats: {
    key: jest.fn((...parts: string[]) => [`mock/${parts.join('/')}`]),
    invalidateAll: jest.fn(),
  },
  invalidateCacheLibraryAllStats: jest.fn(),
  invalidateCacheLibraryLists: jest.fn(),
}))

describe('directories store', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.clearAllMocks()
  })

  async function createTestFile(id: string) {
    await createFileRecord({
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

  describe('sanitizeDirectoryName', () => {
    test('strips forward slashes', () => {
      expect(sanitizeDirectoryName('a/b/c')).toBe('abc')
    })

    test('strips backslashes', () => {
      expect(sanitizeDirectoryName('a\\b')).toBe('ab')
    })

    test('strips control characters', () => {
      expect(sanitizeDirectoryName('foo\x00bar\x1f')).toBe('foobar')
    })

    test('rejects . and ..', () => {
      expect(sanitizeDirectoryName('.')).toBe('')
      expect(sanitizeDirectoryName('..')).toBe('')
      expect(sanitizeDirectoryName('...')).toBe('')
    })

    test('trims whitespace', () => {
      expect(sanitizeDirectoryName('  hello  ')).toBe('hello')
    })

    test('truncates to 255 characters', () => {
      const long = 'x'.repeat(300)
      expect(sanitizeDirectoryName(long)).toHaveLength(255)
    })

    test('preserves valid names', () => {
      expect(sanitizeDirectoryName('Photos 2024')).toBe('Photos 2024')
    })
  })

  describe('createDirectory', () => {
    test('creates directory with correct fields', async () => {
      const dir = await createDirectory('Photos')
      expect(dir.name).toBe('Photos')
      expect(dir.id).toBeDefined()
      expect(dir.createdAt).toBeDefined()
    })

    test('trims whitespace from name', async () => {
      const dir = await createDirectory('  Travel  ')
      expect(dir.name).toBe('Travel')
    })

    test('throws on empty name', async () => {
      await expect(createDirectory('')).rejects.toThrow(
        'Folder name cannot be empty',
      )
    })

    test('strips slashes from name', async () => {
      const dir = await createDirectory('my/dir/name')
      expect(dir.name).toBe('mydirname')
    })

    test('throws on name that sanitizes to empty', async () => {
      await expect(createDirectory('/')).rejects.toThrow(
        'Folder name cannot be empty',
      )
    })

    test('throws on duplicate name (case-insensitive)', async () => {
      await createDirectory('Photos')
      await expect(createDirectory('photos')).rejects.toThrow()
    })
  })

  describe('getOrCreateDirectory', () => {
    test('returns existing directory (case-insensitive)', async () => {
      const original = await createDirectory('Photos')
      const found = await getOrCreateDirectory('photos')
      expect(found.id).toBe(original.id)
    })

    test('creates new directory if not found', async () => {
      const dir = await getOrCreateDirectory('NewDir')
      expect(dir.name).toBe('NewDir')
      expect(dir.id).toBeDefined()
    })
  })

  describe('readAllDirectoriesWithCounts', () => {
    test('returns directories with file counts', async () => {
      const dir = await createDirectory('Photos')
      await createTestFile('file-1')
      await createTestFile('file-2')
      await moveFileToDirectory('file-1', dir.id)
      await moveFileToDirectory('file-2', dir.id)

      const dirs = await readAllDirectoriesWithCounts()
      expect(dirs).toHaveLength(1)
      expect(dirs[0].fileCount).toBe(2)
    })

    test('returns 0 count for empty directories', async () => {
      await createDirectory('Empty')
      const dirs = await readAllDirectoriesWithCounts()
      expect(dirs).toHaveLength(1)
      expect(dirs[0].fileCount).toBe(0)
    })

    test('excludes trashed files from count', async () => {
      const dir = await createDirectory('Photos')
      await createTestFile('file-1')
      await createFileRecord({
        id: 'file-2',
        name: 'file-2.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 100,
        hash: 'hash-file-2',
        createdAt: 1000,
        updatedAt: 1000,
        localId: null,
        addedAt: 1000,
        trashedAt: 2000,
        deletedAt: null,
      })
      await moveFileToDirectory('file-1', dir.id)
      await moveFileToDirectory('file-2', dir.id)

      const dirs = await readAllDirectoriesWithCounts()
      expect(dirs[0].fileCount).toBe(1)
    })
  })

  describe('deleteDirectory', () => {
    test('unlinks files from directory but does not delete them', async () => {
      const dir = await createDirectory('Photos')
      await createTestFile('file-1')
      await createTestFile('file-2')
      await moveFileToDirectory('file-1', dir.id)
      await moveFileToDirectory('file-2', dir.id)

      await deleteDirectory(dir.id)

      const dirs = await readAllDirectoriesWithCounts()
      expect(dirs).toHaveLength(0)

      const f1 = await readFileRecord('file-1')
      const f2 = await readFileRecord('file-2')
      expect(f1).not.toBeNull()
      expect(f2).not.toBeNull()
      expect(await readDirectoryNameForFile('file-1')).toBeUndefined()
      expect(await readDirectoryNameForFile('file-2')).toBeUndefined()
    })

    test('deletes empty directory', async () => {
      const dir = await createDirectory('Empty')

      await deleteDirectory(dir.id)

      const dirs = await readAllDirectoriesWithCounts()
      expect(dirs).toHaveLength(0)
    })
  })

  describe('deleteDirectoryAndTrashFiles', () => {
    test('trashes files and deletes directory', async () => {
      const dir = await createDirectory('Photos')
      await createTestFile('file-1')
      await createTestFile('file-2')
      await moveFileToDirectory('file-1', dir.id)
      await moveFileToDirectory('file-2', dir.id)

      await deleteDirectoryAndTrashFiles(dir.id)

      const dirs = await readAllDirectoriesWithCounts()
      expect(dirs).toHaveLength(0)

      expect(trashFiles).toHaveBeenCalledTimes(1)
      const trashedIds = (trashFiles as jest.Mock).mock.calls[0][0]
      expect(trashedIds.sort()).toEqual(['file-1', 'file-2'])
    })

    test('deletes empty directory without calling trashFiles', async () => {
      const dir = await createDirectory('Empty')

      await deleteDirectoryAndTrashFiles(dir.id)

      const dirs = await readAllDirectoriesWithCounts()
      expect(dirs).toHaveLength(0)
      expect(trashFiles).not.toHaveBeenCalled()
    })

    test('skips already-trashed files', async () => {
      const dir = await createDirectory('Photos')
      await createTestFile('file-1')
      await createFileRecord({
        id: 'file-2',
        name: 'file-2.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 100,
        hash: 'hash-file-2',
        createdAt: 1000,
        updatedAt: 1000,
        localId: null,
        addedAt: 1000,
        trashedAt: 2000,
        deletedAt: null,
      })
      await moveFileToDirectory('file-1', dir.id)
      await moveFileToDirectory('file-2', dir.id)

      await deleteDirectoryAndTrashFiles(dir.id)

      expect(trashFiles).toHaveBeenCalledTimes(1)
      const trashedIds = (trashFiles as jest.Mock).mock.calls[0][0]
      expect(trashedIds).toEqual(['file-1'])
    })
  })

  describe('renameDirectory', () => {
    test('renames directory', async () => {
      const dir = await createDirectory('Photos')
      await renameDirectory(dir.id, 'Images')

      const dirs = await readAllDirectoriesWithCounts()
      expect(dirs[0].name).toBe('Images')
    })

    test('throws on empty name', async () => {
      const dir = await createDirectory('Photos')
      await expect(renameDirectory(dir.id, '')).rejects.toThrow(
        'Folder name cannot be empty',
      )
    })

    test('throws on duplicate name', async () => {
      const dir = await createDirectory('Photos')
      await createDirectory('Videos')
      await expect(renameDirectory(dir.id, 'Videos')).rejects.toThrow(
        'Folder "Videos" already exists',
      )
    })

    test('bumps updatedAt on files in directory', async () => {
      const dir = await createDirectory('Photos')
      await createTestFile('file-1')
      await createTestFile('file-2')
      await moveFileToDirectory('file-1', dir.id)
      await moveFileToDirectory('file-2', dir.id)

      await renameDirectory(dir.id, 'Images')

      const f1 = await readFileRecord('file-1')
      const f2 = await readFileRecord('file-2')
      expect(f1!.updatedAt).toBeGreaterThan(1000)
      expect(f2!.updatedAt).toBeGreaterThan(1000)
    })
  })

  describe('moveFileToDirectory', () => {
    test('moves file to directory', async () => {
      const dir = await createDirectory('Photos')
      await createTestFile('file-1')
      await moveFileToDirectory('file-1', dir.id)

      const name = await readDirectoryNameForFile('file-1')
      expect(name).toBe('Photos')
    })

    test('moves file out of directory with null', async () => {
      const dir = await createDirectory('Photos')
      await createTestFile('file-1')
      await moveFileToDirectory('file-1', dir.id)
      await moveFileToDirectory('file-1', null)

      const name = await readDirectoryNameForFile('file-1')
      expect(name).toBeUndefined()
    })

    test('bumps file updatedAt', async () => {
      const dir = await createDirectory('Photos')
      await createTestFile('file-1')
      await moveFileToDirectory('file-1', dir.id)

      const file = await readFileRecord('file-1')
      expect(file!.updatedAt).toBeGreaterThan(1000)
    })
  })

  describe('moveFilesToDirectory', () => {
    test('moves multiple files to directory', async () => {
      const dir = await createDirectory('Photos')
      await createTestFile('file-1')
      await createTestFile('file-2')
      await moveFilesToDirectory(['file-1', 'file-2'], dir.id)

      const dirs = await readAllDirectoriesWithCounts()
      expect(dirs[0].fileCount).toBe(2)
    })

    test('handles empty array', async () => {
      await expect(moveFilesToDirectory([], null)).resolves.not.toThrow()
    })
  })

  describe('syncDirectoryFromMetadata', () => {
    test('sets directory from metadata name', async () => {
      await createTestFile('file-1')
      await syncDirectoryFromMetadata('file-1', 'Photos')

      const name = await readDirectoryNameForFile('file-1')
      expect(name).toBe('Photos')
    })

    test('preserves local directory when undefined', async () => {
      await createTestFile('file-1')
      await syncDirectoryFromMetadata('file-1', 'Photos')
      await syncDirectoryFromMetadata('file-1', undefined)

      const name = await readDirectoryNameForFile('file-1')
      expect(name).toBe('Photos')
    })

    test('reuses existing directory (case-insensitive)', async () => {
      await createTestFile('file-1')
      await createTestFile('file-2')
      await syncDirectoryFromMetadata('file-1', 'Photos')
      await syncDirectoryFromMetadata('file-2', 'photos')

      const dirs = await readAllDirectoriesWithCounts()
      expect(dirs).toHaveLength(1)
      expect(dirs[0].fileCount).toBe(2)
    })
  })
})
