/*
 * A file saved into Finder reaches the provider as bytes staged under a UUID
 * plus the name the user chose. Its type has to come out the same as the
 * daemon's `sia add` or a phone's import gives the same file, or two devices
 * hold one file under two types.
 */
import * as nodeFs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createNodeDetectMimeType } from '@siastorage/node-adapters/detectMimeType'
import { createEmptyIndexerStorage, type MockIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, type TestApp } from './app'
import { waitForCondition } from './utils'

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
])
const TIFF = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(64)])

describe('A file saved in Finder', () => {
  let shared: MockIndexerStorage
  let mac: TestApp
  let phone: TestApp
  let handoff: string
  let staged = 0

  beforeEach(async () => {
    shared = createEmptyIndexerStorage()
    handoff = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'provider-types-'))
    mac = createTestApp(shared, { handoffDir: handoff, detectMimeType: createNodeDetectMimeType() })
    phone = createTestApp(shared)
    await mac.start()
    await phone.start()
  })

  afterEach(async () => {
    await mac.shutdown()
    await phone.shutdown()
    nodeFs.rmSync(handoff, { recursive: true, force: true })
  })

  function stage(bytes: Buffer | string): string {
    const file = path.join(handoff, `0b6f${++staged}-staged`)
    nodeFs.writeFileSync(file, bytes)
    return file
  }

  it('is typed by its bytes first and its name second, and the other device agrees', async () => {
    await mac.app.provider.create(null, 'photo.txt', 'file', stage(PNG))
    await mac.app.provider.create(null, 'notes.md', 'file', stage('# plain notes'))
    await mac.app.provider.create(null, 'IMG_0001.DNG', 'file', stage(TIFF))

    const expected = {
      'photo.txt': 'image/png',
      'notes.md': 'text/markdown',
      'IMG_0001.DNG': 'image/dng',
    }
    const typesOn = async (app: TestApp) =>
      Object.fromEntries((await app.getFiles()).map((f) => [f.name, f.type]))
    expect(await typesOn(mac)).toEqual(expected)
    await waitForCondition(async () => Object.keys(await typesOn(phone)).length === 3, {
      timeout: 30_000,
      message: 'the phone to receive the three files',
    })
    expect(await typesOn(phone)).toEqual(expected)
  }, 60_000)
})
