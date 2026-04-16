import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ensureDataDir, getDataDir, getPaths } from '../src/paths'

describe('getDataDir', () => {
  const originalEnv = process.env.SIA_DATA_DIR

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SIA_DATA_DIR
    } else {
      process.env.SIA_DATA_DIR = originalEnv
    }
  })

  it('returns ~/.siastorage by default', () => {
    delete process.env.SIA_DATA_DIR
    expect(getDataDir()).toBe(path.join(os.homedir(), '.siastorage'))
  })

  it('respects SIA_DATA_DIR env var', () => {
    process.env.SIA_DATA_DIR = '/tmp/custom-sia'
    expect(getDataDir()).toBe('/tmp/custom-sia')
  })
})

describe('getPaths', () => {
  it('returns all expected paths joined to dataDir', () => {
    const dataDir = '/test/data'
    const p = getPaths(dataDir)
    expect(p.dataDir).toBe('/test/data')
    expect(p.dbPath).toBe('/test/data/data.db')
    expect(p.configPath).toBe('/test/data/config.json')
    expect(p.storagePath).toBe('/test/data/storage.json')
    expect(p.secretsPath).toBe('/test/data/secrets.json')
    expect(p.statePath).toBe('/test/data/state.json')
    expect(p.filesDir).toBe('/test/data/files')
    expect(p.pidPath).toBe('/test/data/daemon.pid')
    expect(p.lockPath).toBe('/test/data/daemon.lock')
    expect(p.sockPath).toBe('/test/data/daemon.sock')
    expect(p.logPath).toBe('/test/data/daemon.log')
  })
})

describe('ensureDataDir', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-paths-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates dataDir and filesDir', () => {
    const dataDir = path.join(tempDir, 'nested', 'data')
    ensureDataDir(dataDir)
    expect(fs.existsSync(dataDir)).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'files'))).toBe(true)
  })

  it('is idempotent', () => {
    const dataDir = path.join(tempDir, 'data')
    ensureDataDir(dataDir)
    ensureDataDir(dataDir)
    expect(fs.existsSync(dataDir)).toBe(true)
  })
})
