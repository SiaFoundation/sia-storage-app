import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DaemonIdentity } from './daemon'

/*
 * What the app does with a daemon already serving when it launches. Each test
 * stands up a fake daemon on the real socket path, answering the calls the app
 * makes, and holding `daemon.lock` until it is told to shut down.
 */

// Set before the imports: the logger fixes its file path when it loads, and
// without this it would write into a real library directory.
const inheritedDataDir = process.env.SIA_DATA_DIR
const dir = mkdtempSync(join(tmpdir(), 'desktop-daemon-'))
process.env.SIA_DATA_DIR = dir

mock.module('electron', () => ({
  app: { getName: () => 'sia.storage.desktop.dev', isPackaged: false },
}))

const { Daemon, daemonAction, expectedDaemonBuild } = await import('./daemon')

const BUILD = '0.0.2+7.abc1234.k2j4x9q1'

function identity(over: Partial<DaemonIdentity> = {}): DaemonIdentity {
  return { build: BUILD, version: '0.0.8', pid: 4242, startedBy: 'desktop', ...over }
}

type FakeDaemon = { calls: string[]; close: () => Promise<void> }

/**
 * Answers `ping` and `shutdown`, and `version` with `reports` unless it is
 * null, which stands for a daemon from before that call existed. On `shutdown`
 * it closes its socket at once and releases the lock 200ms later, the order a
 * real daemon exits in, so a caller that does not wait for the lock still sees
 * it held. With `lingers` it keeps serving and holding the lock instead, as a
 * daemon finishing its uploads does.
 */
function fakeDaemon(reports: DaemonIdentity | null, lingers = false): Promise<FakeDaemon> {
  const lockPath = join(dir, 'daemon.lock')
  // The test runner's own pid, so the lock reads as held by a live process.
  writeFileSync(lockPath, String(process.pid))
  const calls: string[] = []
  const server: Server = createServer((socket) => {
    socket.on('data', (chunk) => {
      const request = JSON.parse(chunk.toString('utf8').split('\n')[0]) as {
        id: string
        method: string
      }
      calls.push(request.method)
      const reply =
        request.method === 'ping' || request.method === 'shutdown'
          ? { id: request.id, ok: true, result: { ok: true } }
          : request.method === 'version' && reports
            ? { id: request.id, ok: true, result: reports }
            : { id: request.id, ok: false, error: `Unknown method: ${request.method}` }
      socket.end(`${JSON.stringify(reply)}\n`)
      if (request.method === 'shutdown' && !lingers) {
        server.close()
        setTimeout(() => rmSync(lockPath, { force: true }), 200)
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(join(dir, 'daemon.sock'), () =>
      resolve({
        calls,
        close: () =>
          new Promise((done) => (server.listening ? server.close(() => done()) : done())),
      }),
    )
  })
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  if (inheritedDataDir === undefined) delete process.env.SIA_DATA_DIR
  else process.env.SIA_DATA_DIR = inheritedDataDir
})

describe('which daemon the app keeps', () => {
  it('keeps one of its own build, and any when it has no build to compare', () => {
    expect(daemonAction(BUILD, identity())).toBe('keep')
    expect(daemonAction(BUILD, identity({ startedBy: 'cli' }))).toBe('keep')
    expect(daemonAction(undefined, identity({ build: 'other' }))).toBe('keep')
    expect(daemonAction(undefined, null)).toBe('keep')
  })

  it('replaces one an earlier desktop install started', () => {
    expect(daemonAction(BUILD, identity({ build: 'earlier' }))).toBe('replace')
    expect(daemonAction(BUILD, identity({ build: null }))).toBe('replace')
  })

  it('asks about one started from a terminal or one that cannot say', () => {
    expect(daemonAction(BUILD, identity({ build: 'earlier', startedBy: 'cli' }))).toBe('ask')
    expect(daemonAction(BUILD, identity({ build: null, startedBy: 'cli' }))).toBe('ask')
    expect(daemonAction(BUILD, null)).toBe('ask')
  })
})

describe('the build the app holds its daemon to', () => {
  const config = {
    domainId: 'sia-test',
    displayName: 'Sia Storage Test',
    extensionBundleId: 'sia.storage.desktop.test.file-provider',
    daemonBuild: BUILD,
  }

  it('is the stamped build when the app runs its bundled daemon', () => {
    expect(expectedDaemonBuild(config, {})).toBe(BUILD)
  })

  it('is none when the app is pointed at another daemon script', () => {
    expect(expectedDaemonBuild(config, { SIA_DAEMON_SCRIPT: '/repo/apps/cli/src/index.ts' })).toBe(
      undefined,
    )
  })
})

describe('reconciling with the daemon serving at launch', () => {
  let fake: FakeDaemon | null = null
  const asked: (DaemonIdentity | null)[] = []
  const answering = (answer: boolean) => async (running: DaemonIdentity | null) => {
    asked.push(running)
    return answer
  }

  beforeEach(() => {
    asked.length = 0
  })

  afterEach(async () => {
    await fake?.close()
    fake = null
    rmSync(join(dir, 'daemon.lock'), { force: true })
    rmSync(join(dir, 'daemon.sock'), { force: true })
  })

  it('does nothing when no daemon is running', async () => {
    const daemon = new Daemon()

    await daemon.reconcile(BUILD, answering(true))

    expect(asked).toEqual([])
    expect(daemon.owned).toBe(false)
  })

  it('keeps and owns a daemon of its own build that the desktop app started', async () => {
    fake = await fakeDaemon(identity())
    const daemon = new Daemon()

    await daemon.reconcile(BUILD, answering(true))

    expect(fake.calls).not.toContain('shutdown')
    expect(asked).toEqual([])
    expect(daemon.owned).toBe(true)
  })

  it('keeps but does not own a daemon of its own build started from a terminal', async () => {
    fake = await fakeDaemon(identity({ startedBy: 'cli' }))
    const daemon = new Daemon()

    await daemon.reconcile(BUILD, answering(true))

    expect(fake.calls).not.toContain('shutdown')
    expect(daemon.owned).toBe(false)
  })

  it('shuts down a daemon from an earlier desktop install without asking', async () => {
    fake = await fakeDaemon(identity({ build: '0.0.1+3.def5678.p0q1r2s3' }))
    const daemon = new Daemon()

    await daemon.reconcile(BUILD, answering(false))

    expect(asked).toEqual([])
    expect(fake.calls).toContain('shutdown')
    expect(Daemon.holdsLock()).toBe(false)
  })

  it('waits out the lock of a daemon that has closed its socket but not yet exited', async () => {
    const lockPath = join(dir, 'daemon.lock')
    writeFileSync(lockPath, String(process.pid))
    setTimeout(() => rmSync(lockPath, { force: true }), 200)

    await new Daemon().reconcile(BUILD, answering(true))

    expect(Daemon.holdsLock()).toBe(false)
  })

  it('identifies a daemon that holds its lock before its socket answers, without waiting out the lock', async () => {
    writeFileSync(join(dir, 'daemon.lock'), String(process.pid))
    const starting = Bun.sleep(200).then(async () => (fake = await fakeDaemon(identity())))
    const begun = Date.now()

    await new Daemon().reconcile(BUILD, answering(true), 5_000)
    await starting

    expect(Date.now() - begun).toBeLessThan(3_000)
    expect(fake!.calls).toContain('version')
    expect(asked).toEqual([])
  })

  it('owns the replacement of a daemon still shutting down when the wait runs out', async () => {
    fake = await fakeDaemon(identity({ build: '0.0.1+3.def5678.p0q1r2s3' }), true)
    const daemon = new Daemon()

    await daemon.reconcile(BUILD, answering(false), 300)

    expect(fake.calls).toContain('shutdown')
    expect(await Daemon.isReachable()).toBe(true)
    expect(daemon.owned).toBe(true)
  })

  it('leaves a terminal daemon of another build running when the user says not now', async () => {
    const running = identity({ build: null, startedBy: 'cli' })
    fake = await fakeDaemon(running)
    const daemon = new Daemon()

    await daemon.reconcile(BUILD, answering(false))

    expect(asked).toEqual([running])
    expect(fake.calls).not.toContain('shutdown')
    expect(daemon.owned).toBe(false)
  })

  it('asks about a daemon that predates the version call, and replaces it when told to', async () => {
    fake = await fakeDaemon(null)
    const daemon = new Daemon()

    await daemon.reconcile(BUILD, answering(true))

    expect(asked).toEqual([null])
    expect(fake.calls).toContain('shutdown')
    expect(Daemon.holdsLock()).toBe(false)
  })
})
