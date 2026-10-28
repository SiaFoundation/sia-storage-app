import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { IpcConnection } from '@siastorage/node-adapters'
import type { CliApp } from '../../src/app'
import { buildHandlerMap } from '../../src/daemon/ipc/index'
import { createTestApp } from '../helpers'

let tempDir: string
let app: CliApp

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-download-ipc-'))
  app = await createTestApp(tempDir)
})

afterEach(() => {
  app.db.close?.()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

it('a download served from the cache marks the cached copy as just used', async () => {
  const bytes = new TextEncoder().encode('cached bytes')
  const now = Date.now()
  await app.service.files.create({
    id: 'f',
    name: 'notes.txt',
    type: 'text/plain',
    kind: 'file',
    size: bytes.length,
    hash: 'sha256:h',
    createdAt: now,
    updatedAt: now,
    addedAt: now,
    mediaAssetId: null,
    trashedAt: null,
    deletedAt: null,
  })
  await app.service.fs.writeFileData({ id: 'f', type: 'text/plain' }, bytes.buffer)
  const longAgo = now - 30 * 24 * 60 * 60 * 1000
  await app.service.fs.upsertMeta({
    fileId: 'f',
    size: bytes.length,
    addedAt: longAgo,
    usedAt: longAgo,
  })

  const download = buildHandlerMap(app, () => {}).get('download')!
  const output = path.join(tempDir, 'out', 'notes.txt')
  await download({ fileId: 'f', output }, {} as IpcConnection)

  expect(fs.readFileSync(output, 'utf8')).toBe('cached bytes')
  expect((await app.service.fs.readMeta('f'))!.usedAt).toBeGreaterThan(longAgo)
})
