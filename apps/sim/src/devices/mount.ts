/**
 * Stands in for a file manager's folder on a CLI device, and for the
 * operating system and the integration behind it.
 *
 * A CLI device is only a daemon. This reaches it the way a Windows sync root
 * provider does: it holds the daemon's mount link open, answers the daemon's
 * requests to remove a copy or to list the files it holds, and tells the
 * daemon the folder changed when it takes a file, as the macOS extension does.
 * The copies are real files in a directory of the device, one per file. The
 * macOS way, where the daemon runs the app's Finder agent and reads Finder's
 * own list, is covered by the desktop device.
 *
 * The link lives in the process that attached it, so a mount is for a
 * scenario run, and a `bun sim` session driven from separate commands has
 * none.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  type HeldMountLink,
  holdMountLink,
  type MountRequestFrame,
} from '@siastorage/node-adapters/mountLink'

type MountItem = { id: string }

export const SIM_MOUNT_ID = 'sim-mount'

export class SimMount {
  private link: HeldMountLink | null = null
  /** What a dehydrate answers for an id instead of removing its copy. */
  private readonly answers = new Map<string, 'refused' | 'busy'>()
  /** Every id a dehydrate asked about, in order. */
  readonly asked: string[] = []

  constructor(
    private readonly device: {
      sockPath: string
      /** Where the folder's copies are kept. */
      dir: string
      stage(bytes: Uint8Array): string
      handoffTarget(): string
      call<T = unknown>(method: string, ...args: unknown[]): Promise<T>
    },
  ) {}

  private path(id: string): string {
    return join(this.device.dir, id)
  }

  /** Registers the mount with the daemon and holds its link open. */
  async attach(): Promise<void> {
    mkdirSync(this.device.dir, { recursive: true })
    await this.connect()
    await this.device.call('settings.setMount', { id: SIM_MOUNT_ID })
  }

  /** Opens the link, again after the daemon restarts, and resolves once the daemon has it. */
  async connect(): Promise<void> {
    this.link?.close()
    this.link = await holdMountLink(this.device.sockPath, (verb, stackIds) =>
      this.answer(verb, stackIds),
    )
  }

  /** Drops the link, as an integration that exited does. */
  detach(): void {
    this.link?.close()
    this.link = null
  }

  private async answer(verb: MountRequestFrame['verb'], stackIds: string[]): Promise<unknown> {
    if (verb === 'list') return this.held()
    const results: Record<string, string> = {}
    for (const id of stackIds) {
      if (verb !== 'dehydrate') {
        results[id] = 'failed'
        continue
      }
      this.asked.push(id)
      results[id] = this.answers.get(id) ?? 'done'
      if (results[id] === 'done') rmSync(this.path(id), { force: true })
    }
    return results
  }

  /** The ids of the files the folder holds. */
  held(): string[] {
    return existsSync(this.device.dir) ? readdirSync(this.device.dir) : []
  }

  /** Removes a file's copy and tells nobody, as the system does while no daemon is running. */
  drop(id: string): void {
    rmSync(this.path(id), { force: true })
  }

  /** Has every dehydrate of `id` keep its copy, as an open or a pinned file does. */
  keep(id: string, answer: 'refused' | 'busy'): void {
    this.answers.set(id, answer)
  }

  /**
   * Opens a file as a user does. One the folder holds is read from its own
   * copy, which the daemon hears of only as an open. Any other is downloaded
   * whole first.
   */
  async open(id: string): Promise<Uint8Array> {
    if (existsSync(this.path(id))) {
      await this.device.call('provider.touch', [id])
    } else {
      const dest = this.device.handoffTarget()
      const { item } = await this.device.call<{ item: MountItem }>('provider.fetch', id, dest)
      renameSync(dest, this.path(item.id))
      await this.device.call('provider.mountChanged')
    }
    return readFileSync(this.path(id))
  }

  /** Creates a file in the folder, as dragging one in does. */
  async create(name: string, bytes: Uint8Array): Promise<MountItem> {
    const staged = this.device.stage(bytes)
    const item = await this.device.call<MountItem>('provider.create', null, name, 'file', staged)
    writeFileSync(this.path(item.id), bytes)
    return item
  }
}
