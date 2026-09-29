/**
 * A pool of devices (simulators or emulators) shared by every session in a
 * checkout. A cold boot takes far longer than wiping the app from a running
 * device, so a phone leases a running device and hands it back when its
 * session is done.
 *
 * Membership and leases are files in the pool's directory, one per device: a
 * file per device rather than one shared list, so phones starting at once
 * never overwrite each other's entries. A lease names the session holding it
 * and is free once that session's directory is gone. Leasing runs under a lock,
 * since two phones starting at once would otherwise both claim the one free
 * device.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { withFileLock } from './lock'
import { sessionDir } from './session'

export class DevicePool {
  constructor(private readonly dir: string) {}

  private file(target: string, suffix: 'lease' | 'member'): string {
    return join(this.dir, `${target}.${suffix}`)
  }

  /** Every device this pool created, whether or not it is still running. */
  members(): string[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.member'))
      .map((f) => f.slice(0, -'.member'.length))
  }

  isLeased(target: string): boolean {
    const file = this.file(target, 'lease')
    return existsSync(file) && existsSync(sessionDir(readFileSync(file, 'utf8').trim()))
  }

  /**
   * Leases the first of `available` no session holds, in the order given, or
   * a device `create` makes, or returns null when neither gives one. `create`
   * calls `adopt` as soon as the device exists, before it boots, so a run
   * killed mid-boot still leaves it in the pool for a drain to find. A member
   * no session holds that fails `keep` is forgotten first, under the same
   * lock, so it cannot race a `create` that has adopted a device not yet
   * ready to pass.
   */
  lease(
    session: string,
    available: string[],
    create: ((adopt: (target: string) => void) => Promise<string>) | null,
    keep?: (target: string) => boolean,
  ): Promise<string | null> {
    mkdirSync(this.dir, { recursive: true })
    return withFileLock(join(this.dir, 'lease.lock'), async () => {
      if (keep) {
        for (const target of this.members()) {
          if (!this.isLeased(target) && !keep(target)) this.forget(target)
        }
      }
      const free = available.find((t) => this.members().includes(t) && !this.isLeased(t))
      const target =
        free ?? (await create?.((t) => writeFileSync(this.file(t, 'member'), ''))) ?? null
      if (target === null) return null
      writeFileSync(this.file(target, 'lease'), session)
      return target
    })
  }

  /** Hands a device back. Rewriting its member file dates it for `idle`. */
  release(target: string): void {
    rmSync(this.file(target, 'lease'), { force: true })
    writeFileSync(this.file(target, 'member'), '')
  }

  /**
   * Members no session holds, handed back at least `forMs` ago and not
   * marked `off`. A device a session never handed back, such as one a killed
   * run held, is dated from when the pool created it.
   */
  idle(forMs: number): string[] {
    return this.members().filter((target) => {
      if (this.isLeased(target)) return false
      const file = this.file(target, 'member')
      return readFileSync(file, 'utf8') !== 'off' && Date.now() - statSync(file).mtimeMs >= forMs
    })
  }

  /** Whether a session holds a member, or one handed back within `forMs` is still on. */
  busy(forMs: number): boolean {
    const idle = new Set(this.idle(forMs))
    return this.members().some((target) => {
      if (this.isLeased(target)) return true
      return !idle.has(target) && readFileSync(this.file(target, 'member'), 'utf8') !== 'off'
    })
  }

  /** Records that a member was shut down but stays in the pool, which `idle` then skips. */
  markOff(target: string): void {
    writeFileSync(this.file(target, 'member'), 'off')
  }

  /** Runs `fn` under the lease lock, so no lease can take a device `fn` is shutting down. */
  locked<T>(fn: () => Promise<T>): Promise<T> {
    mkdirSync(this.dir, { recursive: true })
    return withFileLock(join(this.dir, 'lease.lock'), fn)
  }

  /** Leaves the pool: the device is gone or about to be. */
  forget(target: string): void {
    rmSync(this.file(target, 'lease'), { force: true })
    rmSync(this.file(target, 'member'), { force: true })
  }
}
