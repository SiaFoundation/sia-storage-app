import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getPaths } from '@siastorage/node-adapters'
import { applyForcedReset } from '../../src/daemon/forcedReset'

describe('the daemon forced reset', () => {
  let paths: ReturnType<typeof getPaths>

  beforeEach(() => {
    paths = getPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'forced-reset-')))
    fs.mkdirSync(paths.filesDir, { recursive: true })
  })

  afterEach(() => fs.rmSync(paths.dataDir, { recursive: true, force: true }))

  const storage = () => JSON.parse(fs.readFileSync(paths.storagePath, 'utf8'))

  function seedLibrary() {
    fs.writeFileSync(paths.dbPath, 'db')
    fs.writeFileSync(`${paths.dbPath}-wal`, 'wal')
    fs.writeFileSync(path.join(paths.filesDir, 'cached.bin'), 'bytes')
    fs.writeFileSync(paths.secretsPath, '{"appKey":"secret"}')
    fs.writeFileSync(
      paths.storagePath,
      JSON.stringify({ hasOnboarded: 'true', indexerURL: 'https://idx', syncDownCursor: 'c1' }),
    )
  }

  it('drops the library, cached files and settings, keeping the sign-in', async () => {
    seedLibrary()

    await applyForcedReset(paths, 'beta')

    expect(fs.existsSync(paths.dbPath)).toBe(false)
    expect(fs.existsSync(`${paths.dbPath}-wal`)).toBe(false)
    expect(fs.readdirSync(paths.filesDir)).toEqual([])
    expect(fs.readFileSync(paths.secretsPath, 'utf8')).toBe('{"appKey":"secret"}')
    expect(storage()).toEqual({
      hasOnboarded: 'true',
      indexerURL: 'https://idx',
      completedBetaResetNonce: expect.any(String),
    })
  })

  it('runs again on the next start when a crash cut it off before the database went', async () => {
    seedLibrary()
    // A directory where the database file should be makes deleting it throw,
    // standing in for a crash at the last step.
    fs.rmSync(paths.dbPath)
    fs.mkdirSync(paths.dbPath)
    fs.writeFileSync(path.join(paths.dbPath, 'x'), '')

    await expect(applyForcedReset(paths, 'beta')).rejects.toThrow()

    expect(storage()).toEqual({ hasOnboarded: 'true', indexerURL: 'https://idx' })
    fs.rmSync(paths.dbPath, { recursive: true })
    fs.writeFileSync(paths.dbPath, 'db')

    await applyForcedReset(paths, 'beta')

    expect(fs.existsSync(paths.dbPath)).toBe(false)
    expect(storage()).toEqual({
      hasOnboarded: 'true',
      indexerURL: 'https://idx',
      completedBetaResetNonce: expect.any(String),
    })
  })

  it('keeps the log device id through a reset', async () => {
    seedLibrary()
    const seeded = JSON.parse(fs.readFileSync(paths.storagePath, 'utf8'))
    fs.writeFileSync(paths.storagePath, JSON.stringify({ ...seeded, deviceId: 'device-1' }))

    await applyForcedReset(paths, 'beta')

    expect(storage().deviceId).toBe('device-1')
  })

  it('resets once per nonce', async () => {
    seedLibrary()
    await applyForcedReset(paths, 'beta')
    fs.writeFileSync(paths.dbPath, 'rebuilt')

    await applyForcedReset(paths, 'beta')

    expect(fs.readFileSync(paths.dbPath, 'utf8')).toBe('rebuilt')
  })

  it('only records the nonce when there is no library yet', async () => {
    fs.writeFileSync(paths.storagePath, JSON.stringify({ indexerURL: 'https://idx' }))

    await applyForcedReset(paths, 'beta')

    expect(storage()).toEqual({
      indexerURL: 'https://idx',
      completedBetaResetNonce: expect.any(String),
    })
  })

  it('leaves a production library alone while the production nonce is unset', async () => {
    seedLibrary()

    await applyForcedReset(paths, 'prod')

    expect(fs.readFileSync(paths.dbPath, 'utf8')).toBe('db')
    expect(storage().syncDownCursor).toBe('c1')
  })
})
