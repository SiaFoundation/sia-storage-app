import type { FileRecord } from '@siastorage/core/types'
import { initializeDB, resetDb } from '../db'
import { app } from '../stores/appService'
import { permanentlyDeleteFiles } from './deleteFile'

let removeFileSpy: jest.SpyInstance

describe('deleteFile', () => {
  beforeEach(async () => {
    await initializeDB()
    removeFileSpy = jest.spyOn(app().fs, 'removeFile').mockResolvedValue(undefined)
  })

  afterEach(async () => {
    removeFileSpy.mockRestore()
    await resetDb()
    jest.clearAllMocks()
  })

  test('trashFiles sets trashedAt and bumps updatedAt', async () => {
    await app().files.create({
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
    await app().files.create({
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
    await app().files.create({
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

    await app().files.trash(['file-1', 'file-2'])

    const file1 = await app().files.getById('file-1')
    const file2 = await app().files.getById('file-2')
    const thumb = await app().files.getById('thumb-1')

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
    await app().files.create({
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

    await app().files.trash(['file-1'])

    await app().files.create({
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

    await app().files.trash(['thumb-1'])

    const trashedFile = await app().files.getById('file-1')
    const trashedThumb = await app().files.getById('thumb-1')
    const trashedAt = trashedFile?.updatedAt ?? 0

    expect(trashedFile?.trashedAt).not.toBeNull()
    expect(trashedThumb?.trashedAt).not.toBeNull()

    await app().files.restore(['file-1'])

    const file1 = await app().files.getById('file-1')
    const thumb = await app().files.getById('thumb-1')

    expect(file1?.trashedAt).toBeNull()
    expect(file1?.updatedAt).toBeGreaterThanOrEqual(trashedAt)

    expect(thumb?.trashedAt).toBeNull()
  })

  test('permanentlyDeleteFiles sets tombstone without remote calls', async () => {
    await app().files.create({
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
    await app().files.create({
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
    await app().files.create({
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

    const result1 = await app().files.getById('file-1')
    const result2 = await app().files.getById('file-2')
    const thumb = await app().files.getById('thumb-1')

    expect(result1?.deletedAt).not.toBeNull()
    expect(result1?.trashedAt).not.toBeNull()
    expect(result1?.updatedAt).toBeGreaterThan(1000)

    expect(result2?.deletedAt).not.toBeNull()
    expect(result2?.trashedAt).not.toBeNull()
    expect(result2?.updatedAt).toBeGreaterThan(1000)

    expect(thumb?.deletedAt).not.toBeNull()
    expect(thumb?.trashedAt).not.toBeNull()

    expect(removeFileSpy).toHaveBeenCalledTimes(3)
    expect(removeFileSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-1' }))
    expect(removeFileSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'file-2' }))
    expect(removeFileSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'thumb-1', type: 'image/jpeg' }),
    )
  })

  test('trash and restore cycle covers both files and thumbnails', async () => {
    await app().files.create({
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
    await app().files.create({
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

    await app().files.trash(['file-1'])
    let file = await app().files.getById('file-1')
    let thumb = await app().files.getById('thumb-1')
    expect(file?.trashedAt).not.toBeNull()
    expect(thumb?.trashedAt).not.toBeNull()

    await app().files.restore(['file-1'])
    file = await app().files.getById('file-1')
    thumb = await app().files.getById('thumb-1')
    expect(file?.trashedAt).toBeNull()
    expect(thumb?.trashedAt).toBeNull()

    await app().files.trash(['file-1'])
    file = await app().files.getById('file-1')
    thumb = await app().files.getById('thumb-1')
    expect(file?.trashedAt).not.toBeNull()
    expect(thumb?.trashedAt).not.toBeNull()
  })
})
