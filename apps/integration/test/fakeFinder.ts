/*
 * Stands in for a file manager's folder and the operating system behind it,
 * for tests of a device that has a mount.
 *
 * It does what macOS does with a File Provider domain. It keeps its own copy
 * of each file opened or created in the folder, one version per file. It
 * takes a fetched file out of the handoff directory. It fetches a file again
 * when the library reports a new version of one it holds.
 *
 * Every call into the app goes through `app.provider`, as the extension's
 * calls do, so a test built on this takes the same paths the real one takes.
 */
import type { ProviderItem } from '@siastorage/core/types'
import * as nodeFs from 'fs'
import * as path from 'path'
import type { TestApp } from './app'

export const MOUNT = { id: 'test-mount' }

type Held = { bytes: Buffer; version: string }

export function createFakeFinder(handoffDir: string) {
  /** Whole copies, by the id the app names each file by. */
  const held = new Map<string, Held>()
  /** Ranges read of files not held whole. `served` marks each byte read so far. */
  const partial = new Map<string, { bytes: Buffer; served: Uint8Array; version: string }>()
  let device: TestApp | null = null

  const app = () => {
    if (!device) throw new Error('attach the fake Finder to an app first')
    return device.app
  }

  function keep(id: string, bytes: Buffer, version: string): void {
    held.set(id, { bytes, version })
  }

  function stage(bytes: Buffer): string {
    const staged = path.join(handoffDir, `stage-${crypto.randomUUID()}`)
    nodeFs.writeFileSync(staged, bytes)
    return staged
  }

  /** Downloads a file whole and takes it out of the handoff directory. */
  async function fetch(id: string): Promise<Buffer> {
    const dest = path.join(handoffDir, `fetch-${crypto.randomUUID()}`)
    const { item } = await app().provider.fetch(id, dest)
    const bytes = nodeFs.readFileSync(dest)
    nodeFs.rmSync(dest)
    keep(item.id, bytes, item.contentVersion)
    return bytes
  }

  return {
    held,

    /** Registers the mount with `testApp` and drives it from here on. */
    async attach(testApp: TestApp): Promise<void> {
      device = testApp
      await testApp.app.settings.setMount(MOUNT)
    },

    /**
     * Opens a file as a user does. One the folder holds is read from its own
     * copy, which the app hears of only as a new last used date. Any other
     * is downloaded whole first.
     */
    async open(id: string): Promise<Buffer> {
      const copy = held.get(id)
      if (!copy) return fetch(id)
      await app().provider.touch([id])
      return copy.bytes
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
      // once it has every byte. Ranges can overlap and repeat, so a count of
      // bytes served would call a file whole with its tail never read.
      const known = partial.get(id)
      const size = served.item.size
      const parts =
        known?.version === served.item.contentVersion
          ? known
          : {
              bytes: Buffer.alloc(size),
              served: new Uint8Array(size),
              version: served.item.contentVersion,
            }
      bytes.copy(parts.bytes, served.offset)
      parts.served.fill(1, served.offset, served.offset + served.bytes)
      partial.set(id, parts)
      if (parts.served.every((b) => b === 1)) {
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
  }
}

export type FakeFinder = ReturnType<typeof createFakeFinder>
