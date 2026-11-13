import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderItem } from '@siastorage/core/types'
import { Callback, type CloudEvent, type CloudFiles } from './cloudFiles'
import { createFolder, prune } from './folder'

/*
 * The folder's logic against a real directory, with Windows stood in for.
 * `fakeCloud` keeps what Cloud Files keeps for a file, by file number, so a
 * rename keeps a placeholder and a file written in its place is a plain one,
 * as on Windows. A placeholder has its full size and its own time from the
 * start, and fetching its bytes changes neither, also as on Windows.
 * `daemon` answers `app.provider` and records each call.
 */

type Held = {
  identity: string
  inSync: boolean
  hydrated: boolean
  pinned: boolean
  unpinned: boolean
}

function fakeCloud() {
  const held = new Map<bigint, Held>()
  const of = (path: string) =>
    existsSync(path) ? held.get(statSync(path, { bigint: true }).ino) : undefined
  /** Files a program has open, which cannot be dehydrated. */
  const open = new Set<string>()
  const hydrations: string[] = []
  const failed: CloudEvent[] = []
  /** Writes a placeholder's bytes without the write counting as a change to the file. */
  const fill = (path: string, bytes: Uint8Array, modifiedAt = statSync(path).mtimeMs) => {
    writeFileSync(path, bytes)
    utimesSync(path, modifiedAt / 1000, modifiedAt / 1000)
  }
  const cloud: CloudFiles = {
    poll: () => null,
    create(path, placeholder) {
      if (existsSync(path)) return false
      if (placeholder.directory) mkdirSync(path)
      else fill(path, new Uint8Array(placeholder.size), placeholder.modifiedAt)
      held.set(statSync(path, { bigint: true }).ino, {
        identity: placeholder.identity,
        inSync: placeholder.inSync,
        hydrated: placeholder.directory,
        pinned: false,
        unpinned: false,
      })
      return true
    },
    update(path, placeholder, dehydrate = false) {
      const file = of(path)
      if (!file || (dehydrate && open.has(path))) return false
      if (dehydrate && file.pinned) throw new Error('The file is pinned')
      Object.assign(file, { identity: placeholder.identity, inSync: placeholder.inSync })
      if (dehydrate) {
        file.hydrated = false
        fill(path, new Uint8Array(placeholder.size), placeholder.modifiedAt)
      }
      return true
    },
    dehydrate(path) {
      const file = of(path)
      if (!file || open.has(path)) return 'busy'
      if (file.pinned || !file.inSync) return 'refused'
      file.hydrated = false
      return 'done'
    },
    hydrate: (path) => void hydrations.push(path),
    transfer(fetch, data, offset) {
      const [path, file] = [...paths()].find(([, f]) => f.identity === fetch.identity) ?? []
      if (!path || !file) throw new Error('No such placeholder')
      const bytes = readFileSync(path)
      Buffer.from(data).copy(bytes, offset)
      fill(path, bytes)
      file.hydrated = offset + data.length >= fetch.offset + fetch.length
    },
    failTransfer: (fetch) => void failed.push(fetch),
    placeholder(path) {
      const file = of(path)
      return file ? { identity: file.identity, inSync: file.inSync } : null
    },
    attributes(path) {
      if (!existsSync(path)) return null
      const file = of(path)
      return {
        hydrated: file?.hydrated ?? true,
        pinned: file?.pinned ?? false,
        unpinned: file?.unpinned ?? false,
      }
    },
    pin(path, pinned) {
      const file = of(path)
      if (file) Object.assign(file, { pinned, unpinned: false })
    },
    disconnect() {},
  }
  let root = ''
  function* paths(dir = root): Generator<[string, Held]> {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const file = of(path)
      if (file) yield [path, file]
      if (statSync(path).isDirectory()) yield* paths(path)
    }
  }
  return { cloud, of, open, hydrations, failed, at: (dir: string) => void (root = dir) }
}

function item(id: string, name: string, over: Partial<ProviderItem> = {}): ProviderItem {
  return {
    id,
    parentId: null,
    name,
    kind: 'file',
    mimeType: '',
    size: 4,
    createdAt: 1_000,
    modifiedAt: 2_000,
    contentVersion: 'v1',
    metadataVersion: 'm1',
    uploaded: true,
    uploading: false,
    downloaded: false,
    downloading: false,
    progress: 0,
    ...over,
  }
}

const dir = (id: string, name: string, over: Partial<ProviderItem> = {}) =>
  item(id, name, { kind: 'dir', size: 0, contentVersion: id, ...over })

describe('the File Explorer folder', () => {
  let base: string
  let root: string
  let handoffDir: string
  let windows: ReturnType<typeof fakeCloud>
  let folder: ReturnType<typeof createFolder>
  /** What the daemon lists, and every call made to it. */
  let library: ProviderItem[]
  let calls: unknown[][]
  /** The bytes the daemon holds for a file, served to a read and replaced by a save. */
  let stored: Map<string, Buffer>
  let fails: Set<string>
  /** Runs while the daemon is answering a range, before it answers. */
  let whileFetching: (() => Promise<void>) | undefined
  const abs = (rel: string) => join(root, rel)
  const called = (method: string) => calls.filter(([m]) => m === method).map(([, ...args]) => args)
  const event = (type: number, id: string, rel: string, over: Partial<CloudEvent> = {}) =>
    folder.handle({
      type,
      transferKey: 0n,
      requestKey: 0n,
      offset: 0,
      length: 0,
      identity: windows.of(abs(rel))?.identity ?? `${id}\nv1`,
      ...over,
    })

  async function daemon<T>(method: string, ...args: unknown[]): Promise<T> {
    calls.push([method, ...args])
    if (fails.has(method)) throw new Error(`${method} failed`)
    if (method === 'fetchRange') await whileFetching?.()
    const answer = (): unknown => {
      switch (method) {
        case 'list':
          return { items: library, anchor: 'anchor-1' }
        case 'fetchRange': {
          const [id, dest, offset, length] = args as [string, string, number, number]
          const bytes = (stored.get(id) ?? Buffer.alloc(0)).subarray(offset, offset + length)
          // A daemon on Windows writes a range at the front of the handoff file.
          writeFileSync(dest, bytes)
          return { offset, bytes: bytes.length, item: item(id, 'served') }
        }
        default:
          return undefined
      }
    }
    return answer() as T
  }

  /** Starts the folder over the library as listed, as the provider does when it connects. */
  async function start(items: ProviderItem[] = []): Promise<void> {
    library = items
    folder = createFolder({ root, handoffDir, cloud: windows.cloud, daemon })
    await folder.refresh()
    calls.length = 0
  }

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'windows-folder-'))
    root = join(base, 'Sia Storage')
    handoffDir = join(base, 'handoff')
    mkdirSync(root)
    mkdirSync(handoffDir)
    windows = fakeCloud()
    windows.at(root)
    calls = []
    stored = new Map()
    fails = new Set()
    whileFetching = undefined
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  describe('showing the library', () => {
    it('makes each listed item a placeholder with no bytes, a folder before the file in it', async () => {
      await start([
        item('a', 'inner.txt', { parentId: 'dir:d' }),
        dir('dir:d', 'docs'),
        item('b', 'b.txt'),
      ])

      expect(readdirSync(root).sort()).toEqual(['b.txt', 'docs'])
      expect(windows.of(abs('docs/inner.txt'))).toMatchObject({
        identity: 'a\nv1',
        hydrated: false,
      })
      expect(windows.of(abs('b.txt'))?.inSync).toBe(true)
    })

    it('leaves a file not yet uploaded out of sync, and marks it in sync once it uploads', async () => {
      await start([item('a', 'a.txt', { uploaded: false })])
      expect(windows.of(abs('a.txt'))?.inSync).toBe(false)

      await folder.changes(changesOf([item('a', 'a.txt')]))

      expect(windows.of(abs('a.txt'))?.inSync).toBe(true)
    })

    it('moves a file the library renamed or moved, and a folder with what is in it', async () => {
      await start([
        dir('dir:d', 'docs'),
        item('a', 'a.txt', { parentId: 'dir:d' }),
        item('b', 'b.txt'),
      ])

      await folder.changes(
        changesOf([dir('dir:d', 'papers'), item('b', 'renamed.txt', { parentId: 'dir:d' })]),
      )

      expect(readdirSync(root)).toEqual(['papers'])
      expect(readdirSync(abs('papers')).sort()).toEqual(['a.txt', 'renamed.txt'])
      expect(windows.of(abs('papers/renamed.txt'))?.identity).toBe('b\nv1')
    })

    it('does not move a file over another that was made in the folder', async () => {
      await start([item('a', 'a.txt')])
      writeFileSync(abs('taken.txt'), 'made here')

      await folder.changes(changesOf([item('a', 'taken.txt')]))

      expect(readFileSync(abs('taken.txt'), 'utf8')).toBe('made here')
      expect(existsSync(abs('a.txt'))).toBe(true)
    })

    it('leaves out an item whose name holds a path separator or is `..`, with what is in it', async () => {
      await start([
        item('a', '../escaped.txt'),
        item('b', 'sub\\b.txt'),
        item('c', '..'),
        dir('dir:d', 'x/y'),
        item('e', 'e.txt', { parentId: 'dir:d' }),
        item('ok', 'ok.txt'),
      ])

      expect(readdirSync(root)).toEqual(['ok.txt'])
      expect(readdirSync(base).sort()).toEqual(['Sia Storage', 'handoff'])
    })

    it('does not move a file out of the folder when the library renames it to a path', async () => {
      await start([item('a', 'a.txt')])

      await folder.changes(changesOf([item('a', '../../moved.txt')]))

      expect(readdirSync(root)).toEqual(['a.txt'])
    })

    it('removes an item the library no longer shows, with a folder and what is in it', async () => {
      await start([
        dir('dir:d', 'docs'),
        item('a', 'a.txt', { parentId: 'dir:d' }),
        item('b', 'b.txt'),
      ])

      await folder.changes({ ...changesOf([]), deletedIds: ['dir:d', 'b'] })

      expect(readdirSync(root)).toEqual([])
      expect(calls).toEqual([])
    })

    it('keeps a file saved since the library dropped it', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      write('a.txt', 'saved here and never sent')
      calls.length = 0

      await folder.changes({ ...changesOf([]), deletedIds: ['a'] })

      expect(readFileSync(abs('a.txt'), 'utf8')).toBe('saved here and never sent')
      expect(calls).toEqual([])
    })
  })

  /** Reads a placeholder as a program does: Windows asks for the bytes, and the file is then whole. */
  async function read(id: string, rel: string, bytes: string): Promise<void> {
    stored.set(id, Buffer.from(bytes))
    await event(Callback.fetch, id, rel, { length: bytes.length })
  }

  /** Writes to a file in the folder as a program does. Windows marks a placeholder written to as not in sync. */
  function write(rel: string, text: string): void {
    writeFileSync(abs(rel), text)
    const file = windows.of(abs(rel))
    if (file) file.inSync = false
  }

  const changesOf = (items: ProviderItem[]) => ({
    items,
    deletedIds: [] as string[],
    anchor: 'anchor-2',
    hasMore: false,
    expired: false,
  })

  describe('reading a file', () => {
    it('serves the bytes from the daemon for the version the placeholder holds, and tells the daemon the folder changed', async () => {
      await start([item('a', 'a.txt', { size: 9 })])

      await read('a', 'a.txt', 'the bytes')

      expect(readFileSync(abs('a.txt'), 'utf8')).toBe('the bytes')
      expect(called('fetchRange')).toEqual([['a', expect.any(String), 0, 9, 'v1', true]])
      expect(called('mountChanged')).toEqual([[]])
      expect(readdirSync(handoffDir)).toEqual([])
    })

    it('fails the read when the daemon cannot serve it, and has nothing to tell the daemon', async () => {
      await start([item('a', 'a.txt')])
      fails.add('fetchRange')

      await event(Callback.fetch, 'a', 'a.txt', { length: 4 })

      expect(windows.failed).toHaveLength(1)
      expect(called('mountChanged')).toEqual([])
    })

    it('tells the daemon the folder changed when Windows frees a file', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'the bytes')
      calls.length = 0

      windows.of(abs('a.txt'))!.hydrated = false
      await event(Callback.dehydrated, 'a', 'a.txt')
      expect(called('mountChanged')).toEqual([[]])
    })

    it("does not write a version's bytes into a placeholder another version took meanwhile", async () => {
      await start([item('a', 'a.txt')])
      stored.set('a', Buffer.from('old!'))
      whileFetching = () =>
        folder.changes(changesOf([item('a', 'a.txt', { contentVersion: 'v2', size: 7 })]))

      await event(Callback.fetch, 'a', 'a.txt', { length: 4 })

      expect(windows.of(abs('a.txt'))).toMatchObject({ identity: 'a\nv2', hydrated: false })
      expect(readFileSync(abs('a.txt'))).toEqual(Buffer.alloc(7))
      expect(windows.failed).toHaveLength(1)
    })

    it('counts an opened file as used, once', async () => {
      await start([item('a', 'a.txt')])

      await event(Callback.opened, 'a', 'a.txt')
      await event(Callback.opened, 'a', 'a.txt')

      expect(folder.takeOpened()).toEqual(['a'])
      expect(folder.takeOpened()).toEqual([])
    })
  })

  describe("another device's new version", () => {
    const newer = item('a', 'a.txt', { contentVersion: 'v2', size: 7 })

    it('empties a held file in place, keeps it the same file and tells the daemon the folder changed', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      const before = statSync(abs('a.txt')).ino
      calls.length = 0

      await folder.changes(changesOf([newer]))

      expect(statSync(abs('a.txt')).ino).toBe(before)
      expect(windows.of(abs('a.txt'))).toMatchObject({ identity: 'a\nv2', hydrated: false })
      expect(called('mountChanged')).toEqual([[]])
    })

    it('gives a file not held its new version and tells the daemon nothing', async () => {
      await start([item('a', 'a.txt')])

      await folder.changes(changesOf([newer]))

      expect(windows.of(abs('a.txt'))?.identity).toBe('a\nv2')
      expect(calls).toEqual([])
    })

    it('waits for a program to close the file', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      windows.open.add(abs('a.txt'))

      await folder.changes(changesOf([newer]))
      expect(windows.of(abs('a.txt'))?.identity).toBe('a\nv1')

      windows.open.clear()
      await event(Callback.closed, 'a', 'a.txt')
      expect(windows.of(abs('a.txt'))).toMatchObject({ identity: 'a\nv2', hydrated: false })
    })

    it('fetches a pinned file again, since Windows keeps its bytes', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      windows.cloud.pin(abs('a.txt'), true)

      await folder.changes(changesOf([newer]))

      expect(windows.of(abs('a.txt'))).toMatchObject({ identity: 'a\nv2', pinned: true })
      expect(windows.hydrations).toEqual([abs('a.txt')])
    })

    it('keeps a file pinned when giving it the new version fails', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      windows.cloud.pin(abs('a.txt'), true)
      windows.cloud.update = () => {
        throw new Error('The update failed')
      }

      await folder.changes(changesOf([newer]))

      expect(windows.of(abs('a.txt'))?.pinned).toBe(true)
    })

    it('leaves a file saved here with its bytes', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      write('a.txt', 'edited here')

      await folder.changes(changesOf([newer]))

      expect(readFileSync(abs('a.txt'), 'utf8')).toBe('edited here')
      expect(windows.of(abs('a.txt'))?.identity).toBe('a\nv1')
    })
  })

  describe('keeping a file on the PC and freeing it', () => {
    it('fetches a file marked Always keep on this device', async () => {
      await start([item('a', 'a.txt')])
      windows.cloud.pin(abs('a.txt'), true)

      await folder.examine('a.txt')

      expect(windows.hydrations).toEqual([abs('a.txt')])
    })

    it('removes the bytes of a file marked by Free up space, and tells the daemon', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      windows.of(abs('a.txt'))!.unpinned = true
      calls.length = 0

      await folder.examine('a.txt')

      expect(windows.of(abs('a.txt'))?.hydrated).toBe(false)
      expect(called('mountChanged')).toEqual([[]])
    })
  })

  describe("the daemon's questions over the mount link", () => {
    beforeEach(async () => {
      await start([item('held', 'held.txt'), item('kept', 'kept.txt'), item('cloud', 'cloud.txt')])
      await read('held', 'held.txt', 'held')
      await read('kept', 'kept.txt', 'kept')
      windows.cloud.pin(abs('kept.txt'), true)
      calls.length = 0
    })

    it('lists the files held whole', async () => {
      expect(((await folder.answer('list', [])) as string[]).sort()).toEqual(['held', 'kept'])
    })

    it('leaves out of a list a file still holding the version another device replaced', async () => {
      windows.open.add(abs('held.txt'))
      await folder.changes(changesOf([item('held', 'held.txt', { contentVersion: 'v2' })]))

      expect(await folder.answer('list', [])).toEqual(['kept'])
    })

    it('answers from the placeholders on disk before its first rebuild', async () => {
      const again = createFolder({ root, handoffDir, cloud: windows.cloud, daemon })

      expect(((await again.answer('list', [])) as string[]).sort()).toEqual(['held', 'kept'])
      expect(await again.answer('dehydrate', ['held'])).toEqual({ held: 'done' })
      expect(windows.of(abs('held.txt'))?.hydrated).toBe(false)
    })

    it('dehydrates a held file, refuses a pinned one, and has nothing to do for the rest', async () => {
      expect(await folder.answer('dehydrate', ['held', 'kept', 'cloud', 'gone'])).toEqual({
        held: 'done',
        kept: 'refused',
        cloud: 'done',
        gone: 'done',
      })
      expect(windows.of(abs('held.txt'))?.hydrated).toBe(false)
    })

    it('cannot hand a held file back yet, and says so for a file it does not hold', async () => {
      expect(await folder.answer('resend', ['held', 'cloud'])).toEqual({
        held: 'failed',
        cloud: 'not-hydrated',
      })
    })
  })

  describe('removing the folder on sign-out', () => {
    it('deletes everything the library holds, and the folder with it', async () => {
      await start([
        dir('dir:d', 'docs'),
        item('a', 'a.txt', { parentId: 'dir:d' }),
        item('b', 'b.txt'),
      ])
      await read('b', 'b.txt', 'old!')

      expect(prune(windows.cloud, root)).toBe(true)
      expect(existsSync(root)).toBe(false)
    })

    it('leaves a file saved and never sent, a file that was never a placeholder, and their folders', async () => {
      await start([
        dir('dir:d', 'docs'),
        item('a', 'a.txt', { parentId: 'dir:d' }),
        item('b', 'b.txt'),
      ])
      await read('a', 'docs/a.txt', 'old!')
      // Written to with nothing examining the path, as a save moments before sign-out is.
      write('docs/a.txt', 'saved and never sent')
      writeFileSync(abs('report.tmp'), 'still being written')

      expect(prune(windows.cloud, root)).toBe(false)
      expect(readdirSync(root).sort()).toEqual(['docs', 'report.tmp'])
      expect(readFileSync(abs('docs/a.txt'), 'utf8')).toBe('saved and never sent')
    })
  })

  describe('starting again over a folder that is already there', () => {
    it('finds its placeholders again, with the bytes they hold', async () => {
      await start([item('a', 'a.txt'), item('b', 'b.txt')])
      await read('a', 'a.txt', 'old!')

      await start([item('a', 'a.txt'), item('b', 'b.txt')])

      expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt'])
      expect(windows.of(abs('a.txt'))).toMatchObject({ identity: 'a\nv1', hydrated: true })
      expect(readFileSync(abs('a.txt'), 'utf8')).toBe('old!')
    })

    it("takes the library's name for a file renamed while it was not running", async () => {
      await start([item('a', 'a.txt')])
      renameSync(abs('a.txt'), abs('renamed-here.txt'))

      await start([item('a', 'a.txt')])

      expect(readdirSync(root)).toEqual(['a.txt'])
    })

    it('empties a held file whose version another device replaced while it was not running', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')

      await start([item('a', 'a.txt', { contentVersion: 'v2' })])

      expect(windows.of(abs('a.txt'))).toMatchObject({ identity: 'a\nv2', hydrated: false })
    })

    it('rebuilds past an entry it cannot read, such as a link to nothing', async () => {
      symlinkSync(join(base, 'nowhere'), abs('dangling'))

      await start([item('a', 'a.txt')])

      expect(readdirSync(root).sort()).toEqual(['a.txt', 'dangling'])
    })

    it("keeps an item at the library's path when a copy of its placeholder is listed first", async () => {
      await start([item('b', 'b.txt')])
      // A program's backup of a placeholder is a placeholder with the same identity.
      windows.cloud.create(abs('a-backup.txt'), {
        ...windows.of(abs('b.txt'))!,
        size: 4,
        createdAt: 0,
        modifiedAt: 0,
        directory: false,
      })

      await start([item('b', 'b.txt')])
      await folder.changes(changesOf([item('b', 'b.txt', { contentVersion: 'v2' })]))

      expect(readdirSync(root).sort()).toEqual(['a-backup.txt', 'b.txt'])
      expect(windows.of(abs('b.txt'))?.identity).toBe('b\nv2')
      expect(windows.of(abs('a-backup.txt'))?.identity).toBe('b\nv1')
      expect(calls).toEqual([])
    })

    it('rebuilds when callbacks were lost, from the folder and the library', async () => {
      await start([item('a', 'a.txt')])
      rmSync(abs('a.txt'))

      await folder.handle('dropped')

      expect(readdirSync(root)).toEqual(['a.txt'])
    })

    it('makes a placeholder for an item the library put where one it dropped was, while it was not running', async () => {
      await start([item('x', 'r.txt')])

      await start([item('y', 'r.txt')])

      expect(windows.of(abs('r.txt'))?.identity).toBe('y\nv1')
    })

    it('removes the placeholder of an item the library dropped while it was not running', async () => {
      await start([item('a', 'a.txt'), item('b', 'b.txt')])

      await start([item('b', 'b.txt')])

      expect(readdirSync(root)).toEqual(['b.txt'])
    })
  })
})
