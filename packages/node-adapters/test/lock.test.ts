import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { acquireLock, isDaemonRunning, readDaemonPid } from '../src/lock'

let tempDir: string
let lockPath: string
let pidPath: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-lock-test-'))
  lockPath = path.join(tempDir, 'daemon.lock')
  pidPath = path.join(tempDir, 'daemon.pid')
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('acquireLock', () => {
  it('succeeds and returns handle with fd', () => {
    const handle = acquireLock(lockPath, pidPath)
    expect(handle).not.toBeNull()
    expect(handle!.fd).toBeGreaterThanOrEqual(0)
    handle!.release()
  })

  it('writes PID to pid file', () => {
    const handle = acquireLock(lockPath, pidPath)
    expect(handle).not.toBeNull()
    const pid = fs.readFileSync(pidPath, 'utf-8').trim()
    expect(parseInt(pid, 10)).toBe(process.pid)
    handle!.release()
  })

  it('writes PID to lock file', () => {
    const handle = acquireLock(lockPath, pidPath)
    expect(handle).not.toBeNull()
    const content = fs.readFileSync(lockPath, 'utf-8').trim()
    expect(parseInt(content, 10)).toBe(process.pid)
    handle!.release()
  })
})

describe('release', () => {
  it('removes lock and pid files', () => {
    const handle = acquireLock(lockPath, pidPath)
    expect(handle).not.toBeNull()
    handle!.release()
    expect(fs.existsSync(lockPath)).toBe(false)
    expect(fs.existsSync(pidPath)).toBe(false)
  })

  it('is idempotent', () => {
    const handle = acquireLock(lockPath, pidPath)
    expect(handle).not.toBeNull()
    handle!.release()
    expect(() => handle!.release()).not.toThrow()
  })
})

describe('isDaemonRunning', () => {
  it('returns true when current process PID is in pid file', () => {
    fs.writeFileSync(pidPath, String(process.pid))
    expect(isDaemonRunning(pidPath)).toBe(true)
  })

  it('returns false when pid file does not exist', () => {
    expect(isDaemonRunning(pidPath)).toBe(false)
  })

  it('returns false when PID is not a running process', () => {
    // Use a PID that almost certainly doesn't exist
    fs.writeFileSync(pidPath, '99999999')
    expect(isDaemonRunning(pidPath)).toBe(false)
  })
})

describe('readDaemonPid', () => {
  it('returns PID from file', () => {
    fs.writeFileSync(pidPath, '12345')
    expect(readDaemonPid(pidPath)).toBe(12345)
  })

  it('returns null for missing file', () => {
    expect(readDaemonPid(pidPath)).toBeNull()
  })

  it('returns null for corrupt file', () => {
    fs.writeFileSync(pidPath, 'not a number')
    expect(readDaemonPid(pidPath)).toBeNull()
  })
})
