import * as nodeFs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import { createTestApp, generateTestFiles, type TestApp } from './app'

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
})
