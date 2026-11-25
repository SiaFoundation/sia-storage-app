/*
 * Windows: the shell is a program of ours.
 *
 * The folder File Explorer shows is a Cloud Files sync root, and Windows
 * loads nothing to serve one. A process has to stay connected to it, so the
 * app runs the provider in `native/windows/provider` for as long as it runs
 * itself, starting it once the daemon is up and stopping it before the
 * daemon. The provider is a Bun program, like the daemon, because it reaches
 * Windows through Bun's FFI, and the two meet on the daemon's provider socket.
 *
 * The provider's standard input is how it is stopped: it exits when the pipe
 * closes, which also happens if this process dies, so none is left holding
 * the sync root against the next launch.
 */

import { app } from 'electron'
import { type ChildProcess, spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { log } from '../log'
import { dataDir, providerLogPath } from '../paths'
import { windowsIcon } from './standardChrome'
import type { PlatformIntegration, ShellConfig, ShellState, StopOptions } from './types'

/** The provider is ready once it has registered the folder, which it does by running PowerShell. */
const READY_TIMEOUT_MS = 60_000
const EXIT_TIMEOUT_MS = 5_000
/**
 * How long after the provider exits it is started again. The wait doubles,
 * up to the cap, while it keeps exiting before it is ready.
 */
const RESTART_MS = 1_000
const RESTART_CAP_MS = 60_000

const providerScript = () => join(app.getAppPath(), 'native', 'windows', 'provider', 'main.ts')

const shellPaths = () => ({
  shellSocket: join(dataDir(), 'provider.sock'),
  handoffDir: join(dataDir(), 'handoff'),
})

/** In the user's profile folder, where File Explorer's navigation pane lists it by name. */
const folderFor = (config: ShellConfig) => join(homedir(), config.displayName)

/** Starts the provider in one of its modes, with its errors going to its log. */
function runProvider(config: ShellConfig, mode: 'serve' | 'remove', args: string[]): ChildProcess {
  const logFd = openSync(providerLogPath(), 'a')
  const child = spawn(
    config.runtime,
    [providerScript(), mode, folderFor(config), config.domainId, ...args],
    {
      env: {
        ...process.env,
        SIA_DATA_DIR: dataDir(),
        SIA_PROVIDER_SOCKET: shellPaths().shellSocket,
        SIA_HANDOFF_DIR: shellPaths().handoffDir,
      },
      windowsHide: true,
      stdio: ['pipe', 'pipe', logFd],
    },
  )
  closeSync(logFd)
  return child
}

const exited = (child: ChildProcess) =>
  new Promise<number | null>((resolve) => {
    child.once('exit', resolve)
    // A runtime that cannot be started never exits.
    child.once('error', () => resolve(null))
  })

/**
 * Ends the provider and anything it started. On Windows `kill` ends only the
 * runtime, and a PowerShell it is running to register the folder would go on
 * to register it after sign-out has removed it.
 */
function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
      windowsHide: true,
      stdio: 'ignore',
    })
  } else {
    child.kill()
  }
}

/** Unregisters the sync root and deletes the folder. False when either failed. */
async function removeFolder(config: ShellConfig): Promise<boolean> {
  const code = await exited(runProvider(config, 'remove', []))
  if (code !== 0) log.error('mount', 'remove_failed', { folder: folderFor(config), code })
  return code === 0
}

/** `timing` is shortened by tests. */
export function createWindowsIntegration(
  timing: { readyMs?: number; restartMs?: number } = {},
): PlatformIntegration {
  const { readyMs = READY_TIMEOUT_MS, restartMs = RESTART_MS } = timing
  let state: ShellState = 'absent'
  let provider: ChildProcess | null = null
  let serving: ShellConfig | null = null
  let restart: NodeJS.Timeout | undefined
  let restartIn = restartMs

  /** Runs the provider, and resolves once it is ready, has exited, or has taken too long. */
  function run(config: ShellConfig): Promise<void> {
    state = 'starting'
    const child = runProvider(config, 'serve', [config.displayName, windowsIcon('windows')])
    provider = child
    const gone = exited(child).then((code) => {
      // Still the running provider, so nothing asked it to stop. With none
      // running, a file not on the PC fails to open, so it is started again.
      if (provider !== child) return
      provider = null
      state = 'error'
      log.error('mount', 'provider_exited', { code, startingAgainInMs: restartIn })
      restart = setTimeout(() => void run(config), restartIn)
      restartIn = Math.min(restartIn * 2, RESTART_CAP_MS)
    })
    let timer: NodeJS.Timeout | undefined
    const ready = new Promise<void>((resolve) => {
      // The provider writes only these two words, and a pipe may split one.
      let said = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        if (provider !== child) return
        said += chunk.toString()
        // A folder of the user's own has the name. Starting again would find
        // it there again, so the folder stays unavailable until the next launch.
        if (said.includes('taken')) {
          provider = null
          state = 'error'
          log.error('mount', 'folder_taken', { folder: folderFor(config) })
          resolve()
        } else if (said.includes('ready')) {
          state = 'mounted'
          restartIn = restartMs
          resolve()
        }
      })
      timer = setTimeout(resolve, readyMs)
    })
    return Promise.race([ready, gone]).finally(() => clearTimeout(timer))
  }

  async function stopProvider(): Promise<void> {
    clearTimeout(restart)
    restart = undefined
    const child = provider
    if (!child) return
    provider = null
    child.stdin?.end()
    const timer = setTimeout(() => killTree(child), EXIT_TIMEOUT_MS)
    await exited(child)
    clearTimeout(timer)
  }

  return {
    shellPaths,

    async start(config: ShellConfig) {
      if (provider || restart) return
      serving = config
      await run(config)
    },

    /**
     * Quitting stops the provider and keeps the sync root, so the folder
     * stays in File Explorer with the files it holds, and a file not on the
     * PC fails to open until the app runs again. Signing out removes the
     * folder, since it holds the account's file names and the contents of
     * everything it downloaded.
     */
    async stop(opts?: StopOptions) {
      await stopProvider()
      // Left as an error on failure, so the caller sees the folder is still
      // there and holds the wipe.
      if (opts?.remove && serving && !(await removeFolder(serving))) {
        state = 'error'
        return
      }
      state = 'absent'
      serving = null
    },

    discard: removeFolder,
    status: () => state,
    mountPath: () => (serving && state === 'mounted' ? folderFor(serving) : null),
    // Whatever the provider's state. The app records the mount once after
    // `start` and again only when the daemon reconnects, so a provider that
    // restarts or says it is ready late would otherwise leave the daemon
    // reaching none of the folder's copies until then.
    mount: () => (serving ? { id: serving.domainId } : null),
  }
}
