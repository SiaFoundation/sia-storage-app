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
    convert(path, identity, inSync) {
      if (of(path)) throw new Error('Already a placeholder')
      held.set(statSync(path, { bigint: true }).ino, {
        identity,
        inSync,
        hydrated: true,
        pinned: false,
        unpinned: false,
      })
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
  /** The item the daemon merges a renamed file into, when it does. */
  let mergedInto: string | undefined
  /** The version that replaced a file's base, for the daemon to answer a write of the base's bytes as stale. */
  let staleOver: string | undefined
  /** Takes a staged file as the daemon does, leaving nothing in the handoff folder. */
  const take = (staged: string) => {
    const bytes = readFileSync(staged)
    rmSync(staged)
    return bytes
  }

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
      path: abs(rel),
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
        case 'create': {
          const [parentId, name, kind, staged] = args as [string | null, string, string, string?]
          const id = kind === 'dir' ? `dir:${name}` : `new-${name}`
          if (staged) stored.set(id, take(staged))
          return kind === 'dir'
            ? dir(id, name, { parentId })
            : item(id, name, { parentId, uploaded: false, contentVersion: 'local-1' })
        }
        case 'write': {
          const [id, staged] = args as [string, string]
          const bytes = take(staged)
          // Bytes that are the base version, unedited, after another version replaced it.
          if (staleOver && bytes.equals(stored.get(id) ?? Buffer.alloc(0))) {
            return { ...item(id, 'a.txt', { contentVersion: staleOver }), stale: true }
          }
          stored.set(id, bytes)
          return item(id, 'saved', {
            uploaded: false,
            contentVersion: `saved-${called('write').length}`,
          })
        }
        case 'rename': {
          const [id, parentId, name] = args as [string, string | null, string]
          return item(mergedInto ?? id, name, { parentId })
        }
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
    folder = createFolder({ root, handoffDir, cloud: windows.cloud, daemon, renameHoldMs: 5 })
    await folder.refresh()
    calls.length = 0
  }

  /** Waits out the hold on a file's rename, after which the daemon has been told. */
  const renamesSent = () => Bun.sleep(30)

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
    mergedInto = undefined
    staleOver = undefined
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

    it('keeps a file saved since the library dropped it, and sends it as a new file', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      write('a.txt', 'saved here and never sent')
      calls.length = 0

      await folder.changes({ ...changesOf([]), deletedIds: ['a'] })

      expect(called('create')).toEqual([[null, 'a.txt', 'file', expect.any(String)]])
      expect(stored.get('new-a.txt')?.toString()).toBe('saved here and never sent')
      expect(windows.of(abs('a.txt'))?.identity).toStartWith('new-a.txt\nlocal-1\n')
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

    it('sends a save made here first, instead of dropping it', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      write('a.txt', 'edited here')

      await folder.changes(changesOf([newer]))

      expect(stored.get('a')?.toString()).toBe('edited here')
      expect(readFileSync(abs('a.txt'), 'utf8')).toBe('edited here')
      expect(windows.of(abs('a.txt'))?.identity).toStartWith('a\nsaved-1\n')
    })
  })

  describe('what is done in the folder', () => {
    it('sends a new file to the daemon and makes it a placeholder, out of sync until it uploads', async () => {
      await start()
      writeFileSync(abs('new.txt'), 'made here')

      await folder.examine('new.txt')

      expect(called('create')).toEqual([[null, 'new.txt', 'file', expect.any(String)]])
      expect(stored.get('new-new.txt')?.toString()).toBe('made here')
      expect(windows.of(abs('new.txt'))).toEqual({
        // The third line is the file's signature when its bytes were sent.
        identity: expect.stringMatching(/^new-new\.txt\nlocal-1\n.+/),
        inSync: false,
        hydrated: true,
        pinned: false,
        unpinned: false,
      })
    })

    it('sends a new folder before the file in it, and everything in a folder moved in', async () => {
      await start()
      mkdirSync(abs('docs/deep'), { recursive: true })
      writeFileSync(abs('docs/deep/a.txt'), 'a')

      await folder.examine('docs')

      expect(called('create').map(([parent, name, kind]) => [parent, name, kind])).toEqual([
        [null, 'docs', 'dir'],
        ['dir:docs', 'deep', 'dir'],
        ['dir:deep', 'a.txt', 'file'],
      ])
    })

    it("leaves a program's lock and temporary files alone, and the files Explorer keeps for itself", async () => {
      await start()
      writeFileSync(abs('~$report.docx'), 'lock')
      writeFileSync(abs('report.tmp'), 'temp')
      writeFileSync(abs('desktop.ini'), 'icon')
      writeFileSync(abs('Thumbs.db'), 'thumbnails')

      await folder.scan()

      expect(calls).toEqual([])
    })

    it('removes a library item named like a temporary file when the library drops it', async () => {
      await start([item('t', 'notes.tmp')])

      await folder.changes({ ...changesOf([]), deletedIds: ['t'] })

      expect(readdirSync(root)).toEqual([])
    })

    it('leaves no copy in the handoff folder when the daemon does not take a save, and sends it at the next change', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      write('a.txt', 'saved over')
      fails.add('write')

      await expect(folder.examine('a.txt')).rejects.toThrow(/write failed/)
      expect(readdirSync(handoffDir)).toEqual([])

      fails.clear()
      await folder.examine('a.txt')
      expect(stored.get('a')?.toString()).toBe('saved over')
    })

    it('leaves no copy in the handoff folder when the daemon does not take a new file, and sends it at the next change', async () => {
      await start()
      writeFileSync(abs('new.txt'), 'made here')
      fails.add('create')

      await expect(folder.examine('new.txt')).rejects.toThrow(/create failed/)
      expect(readdirSync(handoffDir)).toEqual([])
      expect(windows.of(abs('new.txt'))).toBeUndefined()

      fails.clear()
      await folder.examine('new.txt')
      expect(stored.get('new-new.txt')?.toString()).toBe('made here')
    })

    it('does not copy a file whose bytes left the PC before its turn to be sent', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      calls.length = 0

      // The answer queues the save, and the file is dehydrated before it runs.
      const answered = folder.answer('resend', ['a'])
      windows.of(abs('a.txt'))!.hydrated = false
      await answered
      await folder.scan()

      expect(called('write')).toEqual([])
    })

    it('sends a save as a new version once, and the placeholder takes the version', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      write('a.txt', 'saved over')

      await event(Callback.closed, 'a', 'a.txt')
      await folder.examine('a.txt')

      expect(called('write')).toEqual([['a', expect.any(String), expect.any(String)]])
      expect(stored.get('a')?.toString()).toBe('saved over')
      expect(windows.of(abs('a.txt'))).toMatchObject({
        identity: expect.stringMatching(/^a\nsaved-1\n/),
        inSync: false,
      })
    })

    it('sends a file a program wrote in place of the old one as a save of the same file', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      rmSync(abs('a.txt'))
      writeFileSync(abs('a.txt'), 'written in its place')

      await event(Callback.deleted, 'a', 'a.txt', { identity: 'a\nv1' })

      expect(called('trash')).toEqual([])
      expect(called('write')).toEqual([['a', expect.any(String), expect.any(String)]])
      expect(windows.of(abs('a.txt'))?.identity).toStartWith('a\nsaved-1\n')
    })

    it('sends a file swapped in for one renamed to a backup as a save of the same file', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      renameSync(abs('a.txt'), abs('a.bak'))
      writeFileSync(abs('a.txt'), 'swapped in')

      await event(Callback.renamed, 'a', 'a.bak')
      rmSync(abs('a.bak'))
      await event(Callback.deleted, 'a', 'a.bak', { identity: 'a\nv1' })

      expect(called('rename')).toEqual([])
      expect(called('trash')).toEqual([])
      expect(stored.get('a')?.toString()).toBe('swapped in')
    })

    it('sends a file swapped in after the rename to a backup was called back as a save of the same file', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      renameSync(abs('a.txt'), abs('a.bak'))
      await event(Callback.renamed, 'a', 'a.bak')

      writeFileSync(abs('a.txt'), 'swapped in')
      await folder.examine('a.txt')
      await renamesSent()

      expect(called('rename')).toEqual([])
      expect(called('create')).toEqual([])
      expect(called('write')).toEqual([['a', expect.any(String), 'v1']])
      expect(stored.get('a')?.toString()).toBe('swapped in')
      expect(windows.of(abs('a.txt'))?.identity).toStartWith('a\n')
    })

    it('sends a swapped-in file as a save even when the backup was deleted first', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      renameSync(abs('a.txt'), abs('a.bak'))
      await event(Callback.renamed, 'a', 'a.bak')
      rmSync(abs('a.bak'))
      await event(Callback.deleted, 'a', 'a.bak', { identity: 'a\nv1' })

      writeFileSync(abs('a.txt'), 'swapped in')
      await folder.examine('a.txt')
      await renamesSent()

      expect(called('trash')).toEqual([])
      expect(called('rename')).toEqual([])
      expect(stored.get('a')?.toString()).toBe('swapped in')
    })

    it('trashes a file renamed and then deleted when nothing takes its place', async () => {
      await start([item('a', 'a.txt')])
      renameSync(abs('a.txt'), abs('b.txt'))
      await event(Callback.renamed, 'a', 'b.txt')
      rmSync(abs('b.txt'))
      await event(Callback.deleted, 'a', 'b.txt', { identity: 'a\nv1' })

      await renamesSent()

      expect(called('rename')).toEqual([])
      expect(called('trash')).toEqual([['a']])
    })

    it('trashes a file Windows calls back about as moved out of the folder', async () => {
      await start([item('a', 'a.txt')])
      renameSync(abs('a.txt'), join(base, 'a.txt'))

      await event(Callback.renamed, 'a', 'a.txt', { path: join(base, 'a.txt') })

      expect(called('trash')).toEqual([['a']])
      expect(called('rename')).toEqual([])
    })

    it('takes the current version when the bytes it sends are the version another device replaced', async () => {
      await start([item('a', 'a.txt')])
      stored.set('a', Buffer.from('old!'))
      await read('a', 'a.txt', 'old!')
      staleOver = 'v2'

      expect(await folder.answer('resend', ['a'])).toEqual({ a: 'asked' })
      await Bun.sleep(10)

      expect(called('write')).toEqual([['a', expect.any(String), 'v1']])
      expect(windows.of(abs('a.txt'))).toMatchObject({ identity: 'a\nv2', hydrated: false })
    })

    it('sends a folder named like a temporary file, and leaves a temporary file of any case on the PC', async () => {
      await start()
      mkdirSync(abs('build.tmp'))
      writeFileSync(abs('REPORT.TMP'), 'scratch')

      await folder.examine('build.tmp')
      await folder.examine('REPORT.TMP')

      expect(called('create')).toEqual([[null, 'build.tmp', 'dir']])
    })

    it('does not take another item moved to the old path of a renamed file for a save of it', async () => {
      await start([item('a', 'a.txt'), item('b', 'b.txt')])
      await read('b', 'b.txt', 'old!')
      renameSync(abs('a.txt'), abs('c.txt'))
      renameSync(abs('b.txt'), abs('a.txt'))

      await event(Callback.renamed, 'a', 'c.txt')
      await renamesSent()

      expect(called('write')).toEqual([])
      expect(called('rename')).toEqual([['a', null, 'c.txt']])
      expect(windows.of(abs('a.txt'))?.identity).toBe('b\nv1')
    })

    it('keeps the entry at the file when the daemon refuses a rename, so a save there is still sent', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      renameSync(abs('a.txt'), abs('b.txt'))
      fails.add('rename')
      await event(Callback.renamed, 'a', 'b.txt')
      await renamesSent()
      expect(called('rename')).toEqual([['a', null, 'b.txt']])

      write('b.txt', 'saved after the rename')
      await folder.examine('b.txt')

      expect(called('write')).toEqual([['a', expect.any(String), expect.any(String)]])
    })

    it('takes the id the daemon answers a rename with, when it merges the file into another', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      renameSync(abs('a.txt'), abs('b.txt'))
      mergedInto = 'merged'

      await event(Callback.renamed, 'a', 'b.txt')
      await renamesSent()
      write('b.txt', 'saved after the merge')
      await folder.examine('b.txt')

      expect(windows.of(abs('b.txt'))?.identity).toStartWith('merged\n')
      expect(called('write')).toEqual([['merged', expect.any(String), expect.any(String)]])
    })

    it("gives a file back the library's name when its rename's callback carries no path", async () => {
      await start([item('a', 'a.txt')])
      renameSync(abs('a.txt'), abs('b.txt'))

      await event(Callback.renamed, 'a', 'b.txt', { path: '' })
      await folder.examine('a.txt')

      expect(readdirSync(root)).toEqual(['a.txt'])
      expect(called('trash')).toEqual([])
    })

    it('does not trash a file renamed while callbacks were lost', async () => {
      await start([item('a', 'a.txt')])
      renameSync(abs('a.txt'), abs('b.txt'))

      // As the provider's loop does: the callbacks it took, then the paths that changed.
      const rebuilt = folder.handle('dropped')
      const examined = folder.examine('a.txt')
      await Promise.all([rebuilt, examined])

      expect(called('trash')).toEqual([])
      expect(readdirSync(root)).toEqual(['a.txt'])
    })

    it('tells the daemon of a rename and of a move into a folder', async () => {
      await start([dir('dir:d', 'docs'), item('a', 'a.txt')])

      renameSync(abs('a.txt'), abs('b.txt'))
      await event(Callback.renamed, 'a', 'b.txt')
      await renamesSent()
      renameSync(abs('b.txt'), abs('docs/b.txt'))
      await event(Callback.renamed, 'a', 'docs/b.txt')
      await renamesSent()

      expect(called('rename')).toEqual([
        ['a', null, 'b.txt'],
        ['a', 'dir:d', 'b.txt'],
      ])
    })

    it('follows a renamed folder, so a file in it is still found', async () => {
      await start([dir('dir:d', 'docs'), item('a', 'a.txt', { parentId: 'dir:d' })])
      await read('a', 'docs/a.txt', 'old!')
      renameSync(abs('docs'), abs('papers'))

      await event(Callback.renamed, 'dir:d', 'papers')
      write('papers/a.txt', 'saved after the rename')
      await folder.examine(join('papers', 'a.txt'))

      expect(called('rename')).toEqual([['dir:d', null, 'papers']])
      expect(stored.get('a')?.toString()).toBe('saved after the rename')
    })

    it('trashes a deleted file, and a deleted folder and each file in it, which Windows deletes first', async () => {
      await start([
        dir('dir:d', 'docs'),
        item('a', 'a.txt', { parentId: 'dir:d' }),
        item('b', 'b.txt'),
      ])

      rmSync(abs('b.txt'))
      await event(Callback.deleted, 'b', 'b.txt', { identity: 'b\nv1' })
      rmSync(abs('docs'), { recursive: true })
      await event(Callback.deleted, 'a', join('docs', 'a.txt'), { identity: 'a\nv1' })
      await event(Callback.deleted, 'dir:d', 'docs', { identity: 'dir:d\ndir:d' })

      expect(called('trash')).toEqual([['b'], ['a'], ['dir:d']])
    })

    it('trashes a file moved out of the folder, which Windows does not call back about', async () => {
      await start([item('a', 'a.txt')])
      renameSync(abs('a.txt'), join(base, 'a.txt'))

      await folder.examine('a.txt')

      expect(called('trash')).toEqual([['a']])
    })

    it('does not trash a renamed file whose close is handled after the rename happened', async () => {
      await start([item('a', 'a.txt')])
      renameSync(abs('a.txt'), abs('b.txt'))

      await event(Callback.closed, 'a', 'a.txt', { identity: 'a\nv1' })
      await event(Callback.renamed, 'a', 'b.txt')
      await renamesSent()

      expect(called('trash')).toEqual([])
      expect(called('rename')).toEqual([['a', null, 'b.txt']])
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

    it("hands a held file's bytes back as a save, and says so for a file it does not hold", async () => {
      expect(await folder.answer('resend', ['held', 'cloud'])).toEqual({
        held: 'asked',
        cloud: 'not-hydrated',
      })
      await folder.scan()

      expect(called('write')).toEqual([['held', expect.any(String), 'v1']])
      expect(stored.get('held')?.toString()).toBe('held')
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
    it('finds its placeholders, and sends a save and a new file made while it was not running', async () => {
      await start([item('a', 'a.txt'), item('b', 'b.txt')])
      await read('a', 'a.txt', 'old!')
      write('a.txt', 'saved while away')
      writeFileSync(abs('made.txt'), 'made while away')

      await start([item('a', 'a.txt'), item('b', 'b.txt')])
      library = []

      expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt', 'made.txt'])
      expect(stored.get('a')?.toString()).toBe('saved while away')
      expect(stored.get('new-made.txt')?.toString()).toBe('made while away')
    })

    it("does not send a save over another device's newer version after starting again", async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      write('a.txt', 'saved here')
      await folder.examine('a.txt')

      // The save has not uploaded, so Windows still has the file out of sync.
      await start([item('a', 'a.txt', { contentVersion: 'v9', size: 9 })])

      expect(stored.get('a')?.toString()).toBe('saved here')
      expect(windows.of(abs('a.txt'))).toMatchObject({ identity: 'a\nv9', hydrated: false })
    })

    it('does not send a file waiting to upload again each time it starts', async () => {
      await start([item('a', 'a.txt')])
      await read('a', 'a.txt', 'old!')
      write('a.txt', 'saved here')
      await folder.examine('a.txt')
      stored.clear()

      await start([item('a', 'a.txt', { contentVersion: 'saved-1', uploaded: false })])

      expect(stored.has('a')).toBe(false)
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
