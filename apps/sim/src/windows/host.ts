/**
 * A Windows machine sim runs devices on, reached three ways. The VM adapter
 * starts it and screenshots it. SSH, as the VM's administrator for the
 * reason `ps` gives, copies files and runs git, installs and builds, which
 * need no desktop. The agent (agent.ts), which a logon task runs in the test
 * account's desktop session, starts and stops the processes that need one,
 * such as Electron, and reads what they write.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { waitFor } from '../wait'
import { ParallelsVm, type VmAdapter } from './vm'

/**
 * What survives a reboot of this Mac: the SSH key, the agent's token and the
 * VM's account passwords. SIM_HOME is under /tmp, which macOS clears.
 */
export const WINDOWS_HOME = process.env.SIM_WINDOWS_HOME ?? join(homedir(), '.sia-sim', 'windows')
export const VM_NAME = process.env.SIM_WINDOWS_VM ?? 'sia-sim-win11'
export const AGENT_PORT = 47800

/** Paths inside the VM. `D:` is the Dev Drive the image creates for builds. */
export const GUEST = {
  agentDir: 'C:\\sia-sim\\agent',
  bun: 'C:\\Tools\\bun\\bun.exe',
  root: 'D:\\sia',
  repo: 'D:\\sia\\repo.git',
  incoming: 'D:\\sia\\incoming',
  worktree: (checkout: string) => `D:\\sia\\worktrees\\${checkout}`,
  deviceDir: (session: string, device: string) => `D:\\sia\\sessions\\${session}\\${device}`,
}

export const TEST_USER = 'siatest'
export const ADMIN_USER = 'siaadmin'

export type Credentials = { adminPassword: string; testPassword: string; agentToken: string }

/** The VM's passwords and agent token, created on first use and kept in WINDOWS_HOME. */
export function credentials(): Credentials {
  const file = join(WINDOWS_HOME, 'credentials.json')
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Credentials
  mkdirSync(WINDOWS_HOME, { recursive: true, mode: 0o700 })
  // Windows requires three of upper, lower, digit and symbol. Hex covers two,
  // so a fixed suffix adds the others.
  const password = () => `${randomBytes(12).toString('hex')}Sa1!`
  const creds = {
    adminPassword: password(),
    testPassword: password(),
    agentToken: randomBytes(24).toString('hex'),
  }
  writeFileSync(file, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 })
  return creds
}

export function sshKeyPath(): string {
  const key = join(WINDOWS_HOME, 'id_ed25519')
  if (!existsSync(key)) {
    mkdirSync(WINDOWS_HOME, { recursive: true, mode: 0o700 })
    const out = Bun.spawnSync([
      'ssh-keygen',
      '-q',
      '-t',
      'ed25519',
      '-N',
      '',
      '-C',
      'sia-sim',
      '-f',
      key,
    ])
    if (out.exitCode !== 0) throw new Error(`ssh-keygen failed: ${out.stderr.toString()}`)
  }
  return key
}

/** A PowerShell script as `-EncodedCommand` takes it, which no shell between here and pwsh re-quotes. */
function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/**
 * A string as a single-quoted PowerShell literal. PowerShell ends such a
 * string at a curly single quote as well as a straight one, and a doubled
 * one of either stands for itself.
 */
export function psQuote(value: string): string {
  return `'${value.replace(/['\u2018-\u201B]/g, (q) => q + q)}'`
}

/**
 * Forgets the VM's SSH host keys, for a VM built again under the same name,
 * which has new keys and would otherwise fail every connection.
 */
export function forgetHostKeys(): void {
  rmSync(join(WINDOWS_HOME, 'known_hosts'), { force: true })
}

type RunResult = { exitCode: number; stdout: string; stderr: string }

export class WindowsHost {
  readonly vm: VmAdapter
  private address: string | null = null

  constructor(vm: VmAdapter = new ParallelsVm(VM_NAME)) {
    this.vm = vm
  }

  /**
   * Finds a VM that is already running, for reads that should not start it
   * or wait on SSH. Throws when it is not running.
   */
  async attach(): Promise<void> {
    if (this.address) return
    if ((await this.vm.state()) !== 'running') throw new Error(`${this.vm.name} is not running`)
    this.address = await this.vm.guestAddress()
    if (!this.address) throw new Error(`${this.vm.name} has no address yet`)
  }

  /** Starts the VM if it is not running, and waits until SSH and the agent answer. */
  async ready(): Promise<void> {
    await this.vm.start()
    this.address = await waitFor(
      `${this.vm.name} to get an address`,
      () => this.vm.guestAddress(),
      {
        timeoutMs: 180_000,
        intervalMs: 1000,
      },
    )
    await waitFor(
      `SSH on ${this.vm.name}`,
      async () => (await this.ps('exit 0', 15_000)).exitCode === 0,
      {
        timeoutMs: 180_000,
        intervalMs: 2000,
      },
    )
    await this.ensureAgent()
  }

  get guest(): string {
    if (!this.address) throw new Error('The Windows host is not ready yet')
    return this.address
  }

  private sshArgs(): string[] {
    return [
      '-i',
      sshKeyPath(),
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      `UserKnownHostsFile=${join(WINDOWS_HOME, 'known_hosts')}`,
      '-o',
      'ConnectTimeout=10',
      '-o',
      'LogLevel=ERROR',
    ]
  }

  /**
   * Runs a PowerShell script over SSH, in session 0 with no desktop, as the
   * administrator. Windows' OpenSSH gives the processes it starts a token
   * that refuses to follow a symbolic link or junction an account that is
   * not an administrator created ("The path cannot be traversed because it
   * contains an untrusted mount point"). `bun install` links every workspace
   * package that way, so as `siatest` the install fails and nothing it
   * installed can be run over SSH. Links an administrator creates are
   * trusted, so installs and builds run as one, and code that has to run as
   * `siatest` goes through the agent, whose desktop session follows links.
   */
  async ps(script: string, timeoutMs = 600_000): Promise<RunResult> {
    const address = this.address ?? (await this.vm.guestAddress())
    if (!address) return { exitCode: -1, stdout: '', stderr: 'no address yet' }
    const proc = Bun.spawn(
      [
        'ssh',
        ...this.sshArgs(),
        `${ADMIN_USER}@${address}`,
        // An uncaught error would reach stderr as CLIXML with color codes, so it
        // is caught and written as plain text.
        `pwsh -NoProfile -NonInteractive -EncodedCommand ${encodePowerShell(
          `$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; $PSStyle.OutputRendering = 'PlainText'
try {
${script}
} catch { [Console]::Error.WriteLine(($_ | Out-String)); exit 1 }`,
        )}`,
      ],
      { stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { exitCode, stdout, stderr }
  }

  async mustPs(script: string, what: string, timeoutMs?: number): Promise<string> {
    const out = await this.ps(script, timeoutMs)
    if (out.exitCode !== 0) {
      throw new Error(
        `${what} failed on ${this.vm.name}: ${(out.stderr || out.stdout).trim().slice(-2000)}`,
      )
    }
    return out.stdout
  }

  /** Copies a file from this Mac to a path in the VM, with forward slashes or backslashes. */
  async copyTo(local: string, remote: string): Promise<void> {
    const out = Bun.spawnSync(
      [
        'scp',
        '-q',
        ...this.sshArgs(),
        local,
        `${ADMIN_USER}@${this.guest}:${remote.replace(/\\/g, '/')}`,
      ],
      { timeout: 600_000 },
    )
    if (out.exitCode !== 0)
      throw new Error(`scp to ${remote} failed: ${out.stderr.toString().trim()}`)
  }

  /** Calls the agent in the desktop session. */
  async agent<T = unknown>(path: string, body: unknown = {}, timeoutMs = 60_000): Promise<T> {
    const res = await fetch(`http://${this.guest}:${AGENT_PORT}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sim-token': credentials().agentToken },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const error = ((await res.json().catch(() => ({}))) as { error?: string }).error
      throw new Error(`agent ${path} failed: ${error ?? `HTTP ${res.status}`}`)
    }
    return (
      res.headers.get('content-type')?.includes('json') ? res.json() : res.arrayBuffer()
    ) as Promise<T>
  }

  /**
   * Replaces the agent when its code differs from this checkout's. The new
   * file is copied over SSH, and the running agent restarts itself so the new
   * one also runs in the desktop session. With no agent answering, the logon
   * task starts one, which also needs the test account signed in.
   */
  private async ensureAgent(): Promise<void> {
    const source = join(import.meta.dir, 'agent.ts')
    const version = createHash('sha256').update(readFileSync(source)).digest('hex')
    const running = await this.agent<{ version: string }>('/health', {}, 3_000).catch(() => null)
    if (running?.version === version) return
    await this.copyTo(source, `${GUEST.agentDir}\\agent.ts`)
    if (running) await this.agent('/restart').catch(() => {})
    else await this.mustPs(`Start-ScheduledTask -TaskName SiaSimAgent`, 'Starting the agent task')
    await waitFor(
      `the agent on ${this.vm.name} to run this checkout's code`,
      async () => (await this.agent<{ version: string }>('/health', {}, 3_000)).version === version,
      { timeoutMs: 60_000, intervalMs: 500 },
    )
  }
}
