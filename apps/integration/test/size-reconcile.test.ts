/**
 * Size reconciliation: a size recorded wrong at import (Android often reports
 * the wrong size) is corrected to the real length after copy, and again from
 * the SDK at upload.
 */

import { extFromMime } from '@siastorage/core/lib/fileTypes'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import * as crypto from 'crypto'
import * as nodeFs from 'fs'
import * as path from 'path'
import { createTestApp, waitForCondition } from './app'

describe('Size reconcile', () => {
  it('copyFile corrects files.size to the real on-disk length without bumping updatedAt', async () => {
    const app = createTestApp(createEmptyIndexerStorage())
    await app.start()

    // A real source file of known size.
    const content = crypto.randomBytes(4096)
    const sourcePath = path.join(app.tempDir, 'source.bin')
    nodeFs.writeFileSync(sourcePath, content)

    // Placeholder created with a wrong size.
    const now = Date.now()
    await app.app.files.create({
      id: 'sz-1',
      name: 'big.bin',
      type: 'application/octet-stream',
      kind: 'file',
      size: 1,
      hash: '',
      createdAt: now,
      updatedAt: now,
      mediaAssetId: null,
      addedAt: now,
      trashedAt: null,
      deletedAt: null,
    })
    const before = await app.getFileById('sz-1')
    expect(before!.size).toBe(1)

    // Copy the real file into local storage.
    await app.app.fs.copyFile({ id: 'sz-1', type: 'application/octet-stream' }, sourcePath)

    // files.size is corrected to the real length, fs.size agrees, and updatedAt
    // is untouched.
    const after = await app.getFileById('sz-1')
    expect(after!.size).toBe(content.length)
    expect(after!.updatedAt).toBe(before!.updatedAt)
    const fsMeta = await app.app.fs.readMeta('sz-1')
    expect(fsMeta!.size).toBe(content.length)

    await app.shutdown()
  })

  it('upload takes the size from the SDK, correcting a mis-recorded size locally and on sync', async () => {
    const indexerStorage = createEmptyIndexerStorage()
    const appA = createTestApp(indexerStorage)
    const appB = createTestApp(indexerStorage)
    await appA.start()
    await appB.start()

    // A file with a wrong recorded size but larger real content, written to its
    // storage path so the uploader reads the true bytes.
    const type = 'application/octet-stream'
    const ext = extFromMime(type)
    const content = crypto.randomBytes(2048)
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    nodeFs.writeFileSync(path.join(appA.tempDir, `wrongsize${ext}`), content)
    const now = Date.now()
    await appA.app.files.create({
      id: 'wrongsize',
      name: 'wrong.bin',
      type,
      kind: 'file',
      size: 1,
      hash,
      createdAt: now,
      updatedAt: now,
      mediaAssetId: null,
      addedAt: now,
      trashedAt: null,
      deletedAt: null,
    })
    await appA.app.fs.upsertMeta({ fileId: 'wrongsize', size: 1, addedAt: now, usedAt: now })

    await appA.waitForNoActiveUploads()

    // Upload corrected the size from the SDK, so the local row is right...
    const onA = await appA.getFileById('wrongsize')
    expect(onA!.size).toBe(content.length)

    // ...and the uploaded metadata carries it, so B receives it correct.
    await waitForCondition(async () => (await appB.getFileById('wrongsize')) != null, {
      timeout: 15_000,
      message: 'B sees the file',
    })
    const onB = await appB.getFileById('wrongsize')
    expect(onB!.size).toBe(content.length)

    await appA.shutdown()
    await appB.shutdown()
  }, 60_000)
})
