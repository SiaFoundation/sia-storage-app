/*
 * Stands in for a file manager's folder and the operating system behind it,
 * for tests of a device that has a mount.
 *
 * It does what macOS does with a File Provider domain. It keeps its own copy
 * of each file opened or created in the folder, one version per file. It
 * takes a fetched file out of the handoff directory. It fetches a file again
 * when the library reports a new version of one it holds. It removes copies
 * on its own, and answers what a mount adapter asks: list what you hold.
 *
 * Every call into the app goes through `app.provider`, as the extension's
 * calls do, so a test built on this takes the same paths the real one takes.
 */
import type { MountAdapter, MountChanges } from '@siastorage/core/adapters'
import type { ProviderItem } from '@siastorage/core/types'
import * as nodeFs from 'fs'
import * as path from 'path'
import type { TestApp } from './app'

export const MOUNT = { id: 'test-mount' }

type Held = { bytes: Buffer; version: string }

export function createFakeFinder(handoffDir: string) {
  /** Whole copies, by the id the app names each file by. */
  const held = new Map<string, Held>()
  const log: { seq: number; id: string; removed: boolean }[] = []
  let seq = 0
  /** Cursors older than this are refused, as macOS refuses an expired anchor. */
  let readableFrom = 0
  /** Ranges read of files not held whole, with how many bytes of each are in. */
  const partial = new Map<string, { bytes: Buffer; got: number; version: string }>()
  let device: TestApp | null = null

  const app = () => {
    if (!device) throw new Error('attach the fake Finder to an app first')
    return device.app
  }

  function keep(id: string, bytes: Buffer, version: string): void {
    held.set(id, { bytes, version })
    log.push({ seq: ++seq, id, removed: false })
  }

  function drop(id: string): void {
    if (held.delete(id)) log.push({ seq: ++seq, id, removed: true })
  }

  function stage(bytes: Buffer): string {
    const staged = path.join(handoffDir, `stage-${crypto.randomUUID()}`)
    nodeFs.writeFileSync(staged, bytes)
    return staged
  }

  /**
   * Downloads a file whole and takes it out of the handoff directory. The app
   * learns that the folder holds it from its next read of the list.
   */
  async function fetch(id: string): Promise<Buffer> {
    const dest = path.join(handoffDir, `fetch-${crypto.randomUUID()}`)
    const { item } = await app().provider.fetch(id, dest)
    const bytes = nodeFs.readFileSync(dest)
    nodeFs.rmSync(dest)
    keep(item.id, bytes, item.contentVersion)
    return bytes
  }

  const adapter: MountAdapter = {
    async changes(_mount, cursor): Promise<MountChanges> {
      if (cursor === null || Number(cursor) < readableFrom) {
        return { cursor: String(seq), full: [...held.keys()] }
      }
      const since = log.filter((entry) => entry.seq > Number(cursor))
      return {
        cursor: String(seq),
        added: since.filter((entry) => !entry.removed).map((entry) => entry.id),
        removed: since.filter((entry) => entry.removed).map((entry) => entry.id),
      }
    },
  }

  return {
    adapter,
    held,

    /** Has the next read of changes from any cursor saved so far answer with the full list. */
    expireCursor(): void {
      readableFrom = seq + 1
    },

    /** Registers the mount with `testApp` and drives it from here on. */
    async attach(testApp: TestApp): Promise<void> {
      device = testApp
      await testApp.app.settings.setMount(MOUNT)
    },

    /**
     * Opens a file as a user does. One the folder holds is read from its own
     * copy, which the app does not hear of. Any other is downloaded whole
     * first.
     */
    async open(id: string): Promise<Buffer> {
      return held.get(id)?.bytes ?? fetch(id)
    },

    /** Reads one range of a file the folder does not hold whole, as a video seek does. */
    async readRange(
      id: string,
      offset: number,
      length: number,
    ): Promise<{ bytes: Buffer; item: ProviderItem }> {
      const dest = path.join(handoffDir, `range-${crypto.randomUUID()}`)
      const asking = (await app().provider.item(id))?.contentVersion
      const served = await app().provider.fetchRange(id, dest, offset, length, asking)
      const bytes = nodeFs.readFileSync(dest).subarray(served.offset, served.offset + served.bytes)
      nodeFs.rmSync(dest)
      // The system keeps the ranges of one version, and holds the file whole
      // once it has every byte, which it reports only as a change to its list.
      const known = partial.get(id)
      const parts =
        known?.version === served.item.contentVersion
          ? known
          : { bytes: Buffer.alloc(served.item.size), got: 0, version: served.item.contentVersion }
      bytes.copy(parts.bytes, served.offset)
      parts.got += served.bytes
      partial.set(id, parts)
      if (parts.got >= served.item.size) {
        partial.delete(id)
        keep(id, parts.bytes, parts.version)
      }
      return { bytes, item: served.item }
    },

    /** Creates a file in the folder, as dragging one in does. */
    async create(parentId: string | null, name: string, bytes: Buffer): Promise<ProviderItem> {
      const item = await app().provider.create(parentId, name, 'file', stage(bytes))
      keep(item.id, bytes, item.contentVersion)
      return item
    },

    /** Saves new bytes over a file in the folder. */
    async save(id: string, bytes: Buffer): Promise<ProviderItem> {
      const item = await app().provider.write(id, stage(bytes))
      keep(item.id, bytes, item.contentVersion)
      return item
    },

    async trash(id: string): Promise<void> {
      await app().provider.trash(id)
      held.delete(id)
    },

    /**
     * Fetches again every held file whose version the library has moved on
     * from, as macOS does for a downloaded file when it is told of a new
     * content version. Returns the ids fetched.
     */
    async followChanges(): Promise<string[]> {
      const fetched: string[] = []
      for (const [id, copy] of held) {
        const item = await app().provider.item(id)
        if (!item) {
          held.delete(id)
        } else if (item.contentVersion !== copy.version) {
          await fetch(id)
          fetched.push(id)
        }
      }
      return fetched
    },

    /** Removes a copy the way the system does on its own, with no word to the app. */
    drop(id: string): void {
      drop(id)
    },
  }
}

export type FakeFinder = ReturnType<typeof createFakeFinder>
