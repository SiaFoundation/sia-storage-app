/**
 * The virtual machine a Windows host runs in, behind the few operations sim
 * needs from it. `WindowsHost` uses only this interface, so another VM tool,
 * or a physical machine whose adapter starts nothing and cannot snapshot, can
 * replace Parallels without touching the devices.
 */

export type VmState = 'running' | 'stopped' | 'suspended' | 'paused' | 'missing' | 'other'

export interface VmAdapter {
  readonly name: string
  state(): Promise<VmState>
  /** Starts or resumes the VM with no window, and resolves once it is running. */
  start(): Promise<void>
  stop(): Promise<void>
  /** The guest's address on the network it shares with this Mac, once it has one. */
  guestAddress(): Promise<string | null>
  /** This Mac's address on that network, which the guest reaches it at. */
  hostAddress(): Promise<string>
  /** The guest's screen as a PNG, whatever session is signed in or whether any agent runs. */
  screenshot(path: string): Promise<void>
  snapshot(name: string): Promise<void>
  revert(name: string): Promise<void>
  /** A linked clone sharing this VM's disk up to its current state. */
  clone(name: string): Promise<VmAdapter>
}

const PRLCTL = '/usr/local/bin/prlctl'
const PRLSRVCTL = '/usr/local/bin/prlsrvctl'

/** Runs prlctl and returns what it printed, or throws with its error. */
export function prlctl(args: string[], timeoutMs = 120_000): string {
  return run([PRLCTL, ...args], timeoutMs)
}

function run(command: string[], timeoutMs = 120_000): string {
  const out = Bun.spawnSync(command, { timeout: timeoutMs })
  if (out.exitCode !== 0) {
    const message = (out.stderr.toString() || out.stdout.toString()).trim()
    throw new Error(`${command.slice(0, 3).join(' ')} failed: ${message}`)
  }
  return out.stdout.toString()
}

type PrlVm = { uuid: string; name: string; status: string; ip_configured?: string }

/** Whether Parallels Desktop's command-line tool, which only the Pro edition has, is installed. */
export function parallelsInstalled(): boolean {
  return Bun.spawnSync(['test', '-x', PRLCTL]).exitCode === 0
}

export class ParallelsVm implements VmAdapter {
  constructor(readonly name: string) {}

  private info(): PrlVm | null {
    const list = JSON.parse(run([PRLCTL, 'list', '--all', '--full', '--json'])) as PrlVm[]
    return list.find((vm) => vm.name === this.name) ?? null
  }

  async state(): Promise<VmState> {
    const status = this.info()?.status
    if (!status) return 'missing'
    return (
      (['running', 'stopped', 'suspended', 'paused'] as const).find((s) => s === status) ?? 'other'
    )
  }

  async start(): Promise<void> {
    const state = await this.state()
    if (state === 'missing') throw new Error(`No Parallels VM named ${this.name}`)
    if (state === 'running') return
    if (state === 'paused') {
      run([PRLCTL, 'resume', this.name])
      return
    }
    // Headless keeps the VM off this Mac's screen. It is set again before a
    // cold start because opening the VM in Parallels' window once sets it
    // back, and Parallels refuses the change on a suspended VM.
    if (state === 'stopped') run([PRLCTL, 'set', this.name, '--startup-view', 'headless'])
    run([PRLCTL, 'start', this.name], 300_000)
  }

  /**
   * Turns off what Parallels shares with a new Windows VM by default: this
   * Mac's home folder, desktop and documents, and opening files across the
   * two. A test VM has no reason to see the person's files, and an app under
   * test could write into them.
   */
  isolate(): void {
    run([
      PRLCTL,
      'set',
      this.name,
      '--shf-host',
      'off',
      '--shared-profile',
      'off',
      '--shared-cloud',
      'off',
      '--smart-mount',
      'off',
      '--sh-app-guest-to-host',
      'off',
      '--sh-app-host-to-guest',
      'off',
    ])
  }

  async stop(): Promise<void> {
    if ((await this.state()) === 'running') run([PRLCTL, 'stop', this.name], 300_000)
  }

  async guestAddress(): Promise<string | null> {
    const ip = this.info()?.ip_configured
    if (!ip || ip === '-') return null
    // A guest with several adapters lists them all, and the first IPv4 one is
    // the shared network's.
    return ip.split(/[\s,]+/).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? null
  }

  async hostAddress(): Promise<string> {
    const info = run([PRLSRVCTL, 'net', 'info', 'Shared'])
    const match = /Parallels adapter:[\s\S]*?IPv4 address:\s*([\d.]+)/.exec(info)
    if (!match)
      throw new Error(`Could not read this Mac's address on Parallels' shared network:\n${info}`)
    return match[1]
  }

  async screenshot(path: string): Promise<void> {
    run([PRLCTL, 'capture', this.name, '--file', path], 60_000)
  }

  async snapshot(name: string): Promise<void> {
    run([PRLCTL, 'snapshot', this.name, '--name', name], 600_000)
  }

  private snapshotId(name: string): string {
    const snapshots = JSON.parse(run([PRLCTL, 'snapshot-list', this.name, '--json'])) as Record<
      string,
      { name: string }
    >
    const id = Object.entries(snapshots).find(([, s]) => s.name === name)?.[0]
    if (!id) throw new Error(`${this.name} has no snapshot named ${name}`)
    return id
  }

  async revert(name: string): Promise<void> {
    run([PRLCTL, 'snapshot-switch', this.name, '--id', this.snapshotId(name)], 600_000)
  }

  async clone(name: string): Promise<VmAdapter> {
    run([PRLCTL, 'clone', this.name, '--name', name, '--linked'], 600_000)
    return new ParallelsVm(name)
  }

  /**
   * Runs a command as SYSTEM through Parallels Tools, for setting the image
   * up before SSH exists. Not part of `VmAdapter`, since only a VM tool with
   * guest tools has it.
   */
  exec(
    command: string[],
    timeoutMs = 600_000,
    stdin?: string,
  ): { exitCode: number; stdout: string; stderr: string } {
    const out = Bun.spawnSync([PRLCTL, 'exec', this.name, ...command], {
      timeout: timeoutMs,
      stdin: stdin === undefined ? 'ignore' : Buffer.from(stdin),
    })
    return {
      exitCode: out.exitCode ?? -1,
      stdout: out.stdout.toString(),
      stderr: out.stderr.toString(),
    }
  }
}
