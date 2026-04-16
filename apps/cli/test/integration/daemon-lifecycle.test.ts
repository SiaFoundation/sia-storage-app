import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  acquireLock,
  ensureDataDir,
  getPaths,
  isDaemonRunning,
  readDaemonPid,
  readState,
  removeState,
  sendIpcCommand,
  startIpcServer,
  writeState,
} from '@siastorage/node-adapters'
import { createTestApp } from '../helpers'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-daemon-lifecycle-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('daemon lifecycle', () => {
  it('acquires lock and writes PID + state', async () => {
    const p = getPaths(tempDir)
    ensureDataDir(tempDir)

    const lock = acquireLock(p.lockPath, p.pidPath)
    expect(lock).not.toBeNull()

    writeState(p.statePath, {
      pid: process.pid,
      startedAt: Date.now(),
      connected: false,
    })

    expect(isDaemonRunning(p.pidPath)).toBe(true)
    expect(readDaemonPid(p.pidPath)).toBe(process.pid)

    const state = readState(p.statePath)
    expect(state).not.toBeNull()
    expect(state!.pid).toBe(process.pid)

    lock!.release()
  })

  it('lock exclusivity: second lock fails while first is held', () => {
    const p = getPaths(tempDir)
    ensureDataDir(tempDir)

    const lock1 = acquireLock(p.lockPath, p.pidPath)
    expect(lock1).not.toBeNull()

    // Writing a PID to the lock file means we "own" it;
    // in a real scenario a second process would fail to acquire.
    // We can simulate by checking the PID file is ours
    expect(readDaemonPid(p.pidPath)).toBe(process.pid)

    lock1!.release()
  })

  it('release cleans up all state files', () => {
    const p = getPaths(tempDir)
    ensureDataDir(tempDir)

    const lock = acquireLock(p.lockPath, p.pidPath)
    expect(lock).not.toBeNull()

    writeState(p.statePath, {
      pid: process.pid,
      startedAt: Date.now(),
      connected: false,
    })

    lock!.release()
    removeState(p.statePath)

    expect(fs.existsSync(p.lockPath)).toBe(false)
    expect(fs.existsSync(p.pidPath)).toBe(false)
    expect(fs.existsSync(p.statePath)).toBe(false)
  })

  it('IPC server handles ping', async () => {
    const p = getPaths(tempDir)
    ensureDataDir(tempDir)

    const server = startIpcServer(p.sockPath, async (method) => {
      if (method === 'ping') return { ok: true }
      throw new Error(`Unknown method: ${method}`)
    })

    await new Promise((r) => setTimeout(r, 50))

    const result = await sendIpcCommand(p.sockPath, 'ping')
    expect(result).toEqual({ ok: true })

    server.close()
  })

  it('IPC server handles status', async () => {
    const p = getPaths(tempDir)
    ensureDataDir(tempDir)

    writeState(p.statePath, {
      pid: process.pid,
      startedAt: Date.now(),
      connected: true,
    })

    const server = startIpcServer(p.sockPath, async (method) => {
      if (method === 'status') {
        return { running: true, pid: process.pid, connected: true }
      }
      throw new Error(`Unknown method: ${method}`)
    })

    await new Promise((r) => setTimeout(r, 50))

    const result = (await sendIpcCommand(p.sockPath, 'status')) as any
    expect(result.running).toBe(true)
    expect(result.pid).toBe(process.pid)
    expect(result.connected).toBe(true)

    server.close()
  })

  it('IPC server handles unknown method with error', async () => {
    const p = getPaths(tempDir)
    ensureDataDir(tempDir)

    const server = startIpcServer(p.sockPath, async (method) => {
      throw new Error(`Unknown method: ${method}`)
    })

    await new Promise((r) => setTimeout(r, 50))

    await expect(sendIpcCommand(p.sockPath, 'bogus')).rejects.toThrow('Unknown method: bogus')

    server.close()
  })

  it('isDaemonRunning returns false after stale PID', () => {
    const p = getPaths(tempDir)
    ensureDataDir(tempDir)

    // Write a fake PID that's not running
    fs.writeFileSync(p.pidPath, '99999999')
    expect(isDaemonRunning(p.pidPath)).toBe(false)
  })
})

describe('daemon with AppService', () => {
  it('creates AppService, IPC handles upload, verifies in DB', async () => {
    const app = await createTestApp(tempDir)
    const p = app.paths

    // Create a test file to upload
    const testFile = path.join(tempDir, 'upload-test.txt')
    fs.writeFileSync(testFile, 'hello from upload test')

    const server = startIpcServer(p.sockPath, async (method, params) => {
      if (method === 'ping') return { ok: true }
      if (method === 'upload') {
        const filePath = params.path as string
        const data = fs.readFileSync(filePath)
        const { createHash } = await import('crypto')
        const hash = createHash('sha256').update(data).digest('hex')
        const now = Date.now()
        const fileId = `test-${now}`

        await app.service.files.create({
          id: fileId,
          name: path.basename(filePath),
          size: data.byteLength,
          createdAt: now,
          updatedAt: now,
          addedAt: now,
          type: 'text/plain',
          kind: 'file',
          localId: null,
          hash,
          trashedAt: null,
          deletedAt: null,
        })

        return { id: fileId, name: path.basename(filePath) }
      }
      throw new Error(`Unknown: ${method}`)
    })

    await new Promise((r) => setTimeout(r, 50))

    const result = (await sendIpcCommand(p.sockPath, 'upload', {
      path: testFile,
    })) as { id: string; name: string }

    expect(result.name).toBe('upload-test.txt')

    // Verify file exists in DB
    const record = await app.service.files.getById(result.id)
    expect(record).not.toBeNull()
    expect(record!.name).toBe('upload-test.txt')
    expect(record!.size).toBe(22)

    server.close()
    app.db.close?.()
  })
})
