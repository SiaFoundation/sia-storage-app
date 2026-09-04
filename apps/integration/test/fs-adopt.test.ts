import { createEmptyIndexerStorage } from '@siastorage/sdk-mock'
import * as nodeFs from 'fs'
import * as path from 'path'
import { createTestApp, generateTestFiles, type TestApp } from './app'

describe('fs.adoptFile', () => {
  let app: TestApp

  beforeEach(async () => {
    app = createTestApp(createEmptyIndexerStorage())
    await app.start()
    app.pause()
  })

  afterEach(async () => {
    await app.shutdown()
  })

  it('hashes the source by default and consumes it', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))
    await app.removeFsFile(file.id, file.type)
    await app.app.fs.deleteMeta(file.id)

    const source = path.join(app.tempDir, 'adopt-source.bin')
    nodeFs.writeFileSync(source, Buffer.alloc(2048, 7))

    const result = await app.app.fs.adoptFile({ id: file.id, type: file.type }, source)

    expect(result.kind).toBe('hashed')
    if (result.kind === 'hashed') expect(result.hash).toMatch(/^sha256:/)
    expect(result.size).toBe(2048)
    expect(nodeFs.existsSync(source)).toBe(false)

    const meta = await app.app.fs.readMeta(file.id)
    expect(meta!.size).toBe(2048)
  })

  it('skips the hash when hash is false, still consuming the source', async () => {
    const [file] = await app.addFiles(generateTestFiles(1, { startId: 1 }))
    await app.removeFsFile(file.id, file.type)
    await app.app.fs.deleteMeta(file.id)

    const source = path.join(app.tempDir, 'adopt-nohash.bin')
    nodeFs.writeFileSync(source, Buffer.alloc(1024, 3))

    const result = await app.app.fs.adoptFile({ id: file.id, type: file.type }, source, {
      hash: false,
    })

    expect(result).toEqual({ kind: 'plain', uri: expect.any(String), size: 1024 })
    expect(nodeFs.existsSync(source)).toBe(false)

    const uri = await app.getFsFileUri({ id: file.id, type: file.type })
    expect(nodeFs.existsSync(uri!.replace('file://', ''))).toBe(true)

    const meta = await app.app.fs.readMeta(file.id)
    expect(meta!.size).toBe(1024)
  })
})
