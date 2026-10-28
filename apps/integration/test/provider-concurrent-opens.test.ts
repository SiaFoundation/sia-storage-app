import * as nodeFs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { EVICT_ALL_BACKED_UP, runCacheEviction } from '@siastorage/core/services'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp } from './app'
import { waitForCondition } from './utils'

describe('Provider opens', () => {
  let app: TestApp
  let handoffDir: string

  beforeEach(async () => {
    handoffDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'provider-opens-'))
    app = createTestApp(createEmptyIndexerStorage(), { handoffDir })
    await app.start()
  })

  afterEach(async () => {
    await app.shutdown()
    nodeFs.rmSync(handoffDir, { recursive: true, force: true })
  })

  it('opening more files at once than the background download queue holds fetches every one', async () => {
    const files = await app.addFiles(generateTestFiles(40, { sizeBytes: 2048 }))
    await app.waitForNoActiveUploads(60_000)
    for (const file of files) await app.removeFsFile(file.id, file.type)

    const results = await Promise.allSettled(
      files.map((file) => app.app.provider.fetch(file.id, path.join(handoffDir, file.id))),
    )

    const failed = results.flatMap((r, i) =>
      r.status === 'rejected' ? [`${files[i].name}: ${(r.reason as Error).message}`] : [],
    )
    expect(failed).toEqual([])
    for (const file of files) {
      expect(nodeFs.statSync(path.join(handoffDir, file.id)).size).toBe(file.size)
    }
  }, 60_000)

  it('an eviction pass skips a file while Finder is opening it, and the open gets its bytes', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { sizeBytes: 4096 }))
    await app.waitForNoActiveUploads()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let opening = false
    const getFileUri = app.app.fs.getFileUri.bind(app.app.fs)
    // The open reads the file's uri, which records the use, right before it
    // exports the copy. Holding it there keeps the open inside its locked step.
    jest.spyOn(app.app.fs, 'getFileUri').mockImplementation(async (target) => {
      if (target.id === file.id && !opening) {
        opening = true
        await held
      }
      return getFileUri(target)
    })
    const dest = path.join(handoffDir, file.id)
    const open = app.app.provider.fetch(file.id, dest)
    await waitForCondition(() => opening, { message: 'the open to reach its export' })

    const result = await runCacheEviction(app.app, EVICT_ALL_BACKED_UP)
    release()
    await open

    expect(result!.evictedFileIds).not.toContain(file.id)
    expect(nodeFs.statSync(dest).size).toBe(file.size)
  }, 60_000)
})
