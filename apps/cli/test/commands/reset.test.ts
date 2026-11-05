import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getPaths } from '@siastorage/node-adapters'
import { resetCommand } from '../../src/commands/reset'

jest.mock('@clack/prompts', () => ({
  confirm: jest.fn(async () => true),
  isCancel: () => false,
}))
jest.mock('../../src/daemon/supervisor', () => ({
  ensureDaemonRunning: jest.fn(async () => {}),
}))

describe('sia reset', () => {
  let paths: ReturnType<typeof getPaths>

  beforeEach(() => {
    paths = getPaths(fs.mkdtempSync(path.join(os.tmpdir(), 'reset-')))
    fs.mkdirSync(paths.filesDir, { recursive: true })
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
    fs.rmSync(paths.dataDir, { recursive: true, force: true })
  })

  it('deletes the cached files with the database and keeps the account secrets', async () => {
    fs.writeFileSync(paths.dbPath, 'db')
    fs.writeFileSync(path.join(paths.filesDir, 'cached.bin'), 'bytes')
    fs.writeFileSync(paths.secretsPath, '{"appKey":"secret"}')

    await resetCommand(paths.dataDir)

    expect(fs.existsSync(paths.dbPath)).toBe(false)
    expect(fs.readdirSync(paths.filesDir)).toEqual([])
    expect(fs.readFileSync(paths.secretsPath, 'utf8')).toBe('{"appKey":"secret"}')
  })

  it('deletes nothing while a daemon that will not stop is still running', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    // This test's own process stands in for a daemon that outlives the wait.
    fs.writeFileSync(paths.pidPath, String(process.pid))
    fs.writeFileSync(paths.dbPath, 'db')
    fs.writeFileSync(path.join(paths.filesDir, 'cached.bin'), 'bytes')

    await resetCommand(paths.dataDir)

    expect(process.exitCode).toBe(1)
    expect(fs.existsSync(paths.dbPath)).toBe(true)
    expect(fs.readdirSync(paths.filesDir)).toEqual(['cached.bin'])
    process.exitCode = 0
  }, 15_000)
})
