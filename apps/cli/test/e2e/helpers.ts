import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { getPaths, readDaemonPid, sendIpcCommand } from '@siastorage/node-adapters'

export type ExecResult = {
  stdout: string
  stderr: string
  exitCode: number
}

// oxlint-disable-next-line no-control-regex -- intentional: stripping ANSI escape sequences
const ANSI_RE = /\x1b\[[0-9;]*m/g

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

const BINARY_PATH = path.resolve(__dirname, '../../dist/sia')

export function createE2eContext() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-e2e-'))
  const p = getPaths(dataDir)
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    SIA_DATA_DIR: dataDir,
    SIA_TEST_MODE: '1',
    NO_COLOR: '1',
  }

  async function sia(...args: string[]): Promise<ExecResult> {
    return new Promise((resolve) => {
      execFile(BINARY_PATH, args, { env, timeout: 30_000 }, (error, stdout, stderr) => {
        resolve({
          stdout: stripAnsi(stdout.toString()),
          stderr: stripAnsi(stderr.toString()),
          exitCode: error ? ((error as any).code ?? 1) : 0,
        })
      })
    })
  }

  async function startDaemon(): Promise<void> {
    await sia('daemon', 'start')

    // Poll until daemon responds to ping via IPC
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      try {
        await sendIpcCommand(p.sockPath, 'ping', {}, 1000)
        return
      } catch {
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    throw new Error('Daemon failed to start within 15s')
  }

  async function stopDaemon(): Promise<void> {
    const pid = readDaemonPid(p.pidPath)
    if (!pid) return

    try {
      await sendIpcCommand(p.sockPath, 'shutdown', {}, 3000)
    } catch {
      // IPC may close before response
    }

    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0)
        await new Promise((r) => setTimeout(r, 100))
      } catch {
        return
      }
    }
  }

  function cleanup() {
    const pid = readDaemonPid(p.pidPath)
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // already dead
      }
    }
    try {
      fs.rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }

  function createTempFile(name: string, content: string | Buffer): string {
    const filePath = path.join(dataDir, name)
    fs.writeFileSync(filePath, content)
    return filePath
  }

  return { dataDir, sia, startDaemon, stopDaemon, cleanup, createTempFile, paths: p }
}
