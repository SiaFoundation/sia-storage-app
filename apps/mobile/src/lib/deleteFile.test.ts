jest.mock('../stores/fs', () => ({
  removeFsFile: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../stores/tempFs', () => ({
  removeTempDownloadFile: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../stores/uploads', () => ({
  removeUploads: jest.fn(),
}))

import { initializeDB, resetDb } from '../db'
import {
  createFileRecord,
  type FileRecord,
  readFileRecord,
} from '../stores/files'
import { removeFsFile } from '../stores/fs'
import { removeTempDownloadFile } from '../stores/tempFs'
import { permanentlyDeleteFiles, restoreFiles, trashFiles } from './deleteFile'

describe('deleteFile', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    await resetDb()
    jest.clearAllMocks()
  })

  test('trashFiles sets trashedAt and bumps updatedAt', async () => {
    await createFileRecord({
      id: 'file-1',
      name: 'test1.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-1',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    })
    await createFileRecord({
      id: 'file-2',
      name: 'test2.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-2',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    })
    await createFileRecord({
      id: 'thumb-1',
      name: 'thumb1.jpg',
      type: 'image/jpeg',
      kind: 'thumb',
      size: 50,
      hash: 'hash-thumb-1',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      thumbForId: 'file-1',
      thumbSize: 64,
      trashedAt: null,
      deletedAt: null,
    })

    await trashFiles(['file-1', 'file-2'])

    const file1 = await readFileRecord('file-1')
    const file2 = await readFileRecord('file-2')
    const thumb = await readFileRecord('thumb-1')

    expect(file1?.trashedAt).not.toBeNull()
    expect(file1?.updatedAt).toBeGreaterThan(1000)
    expect(file1?.deletedAt).toBeNull()

    expect(file2?.trashedAt).not.toBeNull()
    expect(file2?.updatedAt).toBeGreaterThan(1000)
    expect(file2?.deletedAt).toBeNull()

    expect(thumb?.trashedAt).not.toBeNull()
    expect(thumb?.updatedAt).toBeGreaterThan(1000)
  })

  test('restoreFiles clears trashedAt and bumps updatedAt', async () => {
    await createFileRecord({
      id: 'file-1',
      name: 'test1.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-1',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    })

    await trashFiles(['file-1'])

    await createFileRecord({
      id: 'thumb-1',
      name: 'thumb1.jpg',
      type: 'image/jpeg',
      kind: 'thumb',
      size: 50,
      hash: 'hash-thumb-1',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      thumbForId: 'file-1',
      thumbSize: 64,
      trashedAt: null,
      deletedAt: null,
    })

    await trashFiles(['thumb-1'])

    const trashedFile = await readFileRecord('file-1')
    const trashedThumb = await readFileRecord('thumb-1')
    const trashedAt = trashedFile?.updatedAt ?? 0

    expect(trashedFile?.trashedAt).not.toBeNull()
    expect(trashedThumb?.trashedAt).not.toBeNull()

    await restoreFiles(['file-1'])

    const file1 = await readFileRecord('file-1')
    const thumb = await readFileRecord('thumb-1')

    expect(file1?.trashedAt).toBeNull()
    expect(file1?.updatedAt).toBeGreaterThanOrEqual(trashedAt)

    expect(thumb?.trashedAt).toBeNull()
  })

  test('permanentlyDeleteFiles sets tombstone without remote calls', async () => {
    await createFileRecord({
      id: 'file-1',
      name: 'test1.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-1',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    })
    await createFileRecord({
      id: 'file-2',
      name: 'test2.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-2',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    })
    await createFileRecord({
      id: 'thumb-1',
      name: 'thumb1.jpg',
      type: 'image/jpeg',
      kind: 'thumb',
      size: 50,
      hash: 'hash-thumb-1',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      thumbForId: 'file-1',
      thumbSize: 64,
      trashedAt: null,
      deletedAt: null,
    })

    const file1: FileRecord = {
      id: 'file-1',
      name: 'test1.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-1',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
      objects: {},
    }
    const file2: FileRecord = {
      id: 'file-2',
      name: 'test2.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-2',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
      objects: {},
    }

    await permanentlyDeleteFiles([file1, file2])

    const result1 = await readFileRecord('file-1')
    const result2 = await readFileRecord('file-2')
    const thumb = await readFileRecord('thumb-1')

    expect(result1?.deletedAt).not.toBeNull()
    expect(result1?.trashedAt).not.toBeNull()
    expect(result1?.updatedAt).toBeGreaterThan(1000)

    expect(result2?.deletedAt).not.toBeNull()
    expect(result2?.trashedAt).not.toBeNull()
    expect(result2?.updatedAt).toBeGreaterThan(1000)

    expect(thumb?.deletedAt).not.toBeNull()
    expect(thumb?.trashedAt).not.toBeNull()

    expect(removeFsFile).toHaveBeenCalledTimes(3)
    expect(removeFsFile).toHaveBeenCalledWith(file1)
    expect(removeFsFile).toHaveBeenCalledWith(file2)
    expect(removeFsFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'thumb-1', type: 'image/jpeg' }),
    )

    expect(removeTempDownloadFile).toHaveBeenCalledTimes(3)
    expect(removeTempDownloadFile).toHaveBeenCalledWith(file1)
    expect(removeTempDownloadFile).toHaveBeenCalledWith(file2)
    expect(removeTempDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'thumb-1', type: 'image/jpeg' }),
    )
  })

  test('trash and restore cycle covers both files and thumbnails', async () => {
    await createFileRecord({
      id: 'file-1',
      name: 'test1.jpg',
      type: 'image/jpeg',
      kind: 'file',
      size: 100,
      hash: 'hash-1',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      thumbForId: undefined,
      thumbSize: undefined,
      trashedAt: null,
      deletedAt: null,
    })
    await createFileRecord({
      id: 'thumb-1',
      name: 'thumb1.webp',
      type: 'image/webp',
      kind: 'thumb',
      size: 50,
      hash: 'hash-thumb-1',
      createdAt: 1000,
      updatedAt: 1000,
      localId: null,
      addedAt: 1000,
      thumbForId: 'file-1',
      thumbSize: 64,
      trashedAt: null,
      deletedAt: null,
    })

    await trashFiles(['file-1'])
    let file = await readFileRecord('file-1')
    let thumb = await readFileRecord('thumb-1')
    expect(file?.trashedAt).not.toBeNull()
    expect(thumb?.trashedAt).not.toBeNull()

    await restoreFiles(['file-1'])
    file = await readFileRecord('file-1')
    thumb = await readFileRecord('thumb-1')
    expect(file?.trashedAt).toBeNull()
    expect(thumb?.trashedAt).toBeNull()

    await trashFiles(['file-1'])
    file = await readFileRecord('file-1')
    thumb = await readFileRecord('thumb-1')
    expect(file?.trashedAt).not.toBeNull()
    expect(thumb?.trashedAt).not.toBeNull()
  })
})
