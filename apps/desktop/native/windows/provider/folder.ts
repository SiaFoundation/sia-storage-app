/*
 * The library's folder in File Explorer: what it holds, and what to do about
 * each change to the library and each thing Windows or the daemon asks.
 *
 * It does what the File Provider extension does on macOS, in the shape
 * Windows asks for. The library arrives as items the daemon lists and as its
 * change feed, and each one becomes a placeholder, a move, a new version or a
 * removal in the folder. Windows calls back about a placeholder that was
 * read, opened, closed or dehydrated, and a file pinned or freed in Explorer
 * shows as a change to its path. And the daemon asks over its mount link for
 * files to be dehydrated or listed.
 *
 * Nothing is kept between runs. A placeholder's identity holds the item id
 * and the content version its bytes belong to, so `refresh` rebuilds
 * everything from the folder and the daemon's list.
 *
 * Not handled yet: what is done to the folder's own files. A file or folder
 * made there, a save, a rename, a move and a delete do not reach the library,
 * and a file saved there keeps its bytes when the library moves on. Also not
 * handled: an item whose name Windows cannot hold, or holds a path separator,
 * or whose path another item or a file made here already has, including by a
 * name that differs only in case, is left out of the folder. A file added to
 * the library on this PC outside the folder cannot be read here until it has
 * uploaded. A folder the library moved while a program holds a file in it
 * open stays where it is until the next rebuild.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join, sep } from 'node:path'
import {
  type ProviderChanges,
  type ProviderItem,
  type ProviderPage,
  type ProviderRangeResult,
  WORKING_SET_ID,
} from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import type { MountRequestFrame } from '@siastorage/node-adapters/mountLink'
import { Callback, type CloudEvent, type CloudFiles, type Placeholder } from './cloudFiles'

/** Bytes asked of the daemon per call. Each transfer restarts the system's 60 second fetch timeout. */
const FETCH_CHUNK = 4 * 1024 * 1024

/** One file or folder in the sync root, by the id the daemon names it by. */
type Entry = {
  id: string
  /** Path under the root. */
  rel: string
  directory: boolean
  /** The content version the placeholder's bytes belong to. */
  version: string
  /** `signature` of the file when the daemon last had its bytes. Empty when that is not known. */
  sent: string
  /** A newer version from another device, waiting for a program to close the file. */
  newer?: ProviderItem
}

export type FolderOptions = {
  /** The sync root. */
  root: string
  /** Where bytes pass between this process and the daemon. */
  handoffDir: string
  cloud: CloudFiles
  /** Calls a method of the daemon's `app.provider`. */
  daemon<T = unknown>(method: string, ...args: unknown[]): Promise<T>
}

/** A placeholder's identity, a line each: the item id, and the content version its bytes belong to. */
function parseIdentity(text: string): { id: string; version: string } {
  const [id, version = ''] = text.split('\n')
  return { id, version }
}

function placeholder(item: ProviderItem): Placeholder {
  const directory = item.kind === 'dir'
  return {
    identity: `${item.id}\n${item.contentVersion}`,
    size: item.size,
    createdAt: item.createdAt,
    modifiedAt: item.modifiedAt,
    directory,
    inSync: directory || item.uploaded,
  }
}

/**
 * What tells one state of a file's bytes from another without reading them.
 * A program that saves by replacing the file leaves a new file number, even
 * where it keeps the size and the time.
 */
function signature(path: string): string {
  const stat = statSync(path, { bigint: true })
  return `${stat.ino}:${stat.mtimeNs}:${stat.size}`
}

/**
 * Whether `path` is inside the folder whose real path is `realRoot`, and not
 * reached through a junction or link made in it to somewhere else. Following
 * one would read, and delete, files that are not the library's, such as
 * another provider's placeholders. Windows names ignore case.
 */
function within(realRoot: string, path: string): boolean {
  let real: string
  try {
    real = realpathSync.native(path).toLowerCase()
  } catch {
    return false
  }
  const top = realRoot.toLowerCase()
  return real === top || real.startsWith(top + sep)
}

/**
 * Removes what is left of an item the library no longer shows, `path` in the
 * sync root `root`, all of it by default. Returns false, leaving it, where it
 * holds bytes the daemon was never sent: a file that is no placeholder, a
 * placeholder saved to since, or a folder with either in it. A junction or
 * link to outside the root is left too.
 */
export function prune(cloud: CloudFiles, root: string, path = root): boolean {
  const realRoot = realpathSync.native(root)
  const remove = (path: string): boolean => {
    if (!within(realRoot, path)) return false
    if (statSync(path).isDirectory()) {
      const emptied = readdirSync(path).map((name) => remove(join(path, name)))
      if (emptied.includes(false)) return false
      // Not removed with what is inside it, which would take a file a program
      // made after the listing above, one this check never saw.
      try {
        rmdirSync(path)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOTEMPTY') return false
        throw e
      }
      return true
    }
    const held = cloud.placeholder(path)
    if (!held || (cloud.attributes(path)?.hydrated && !held.inSync)) return false
    rmSync(path)
    return true
  }
  return remove(path)
}

export function createFolder({ root, handoffDir, cloud, daemon }: FolderOptions) {
  const byId = new Map<string, Entry>()
  const byRel = new Map<string, Entry>()
  /** Files opened since `touchOpened` last told the daemon. */
  const opened = new Set<string>()
  // Windows names ignore case.
  const key = (rel: string) => rel.toLowerCase()
  const abs = (rel: string) => join(root, rel)
  /**
   * Whether `path` is still in the folder. A folder indexed here can be
   * replaced by a junction to somewhere else, and a path through it would then
   * move or empty files that are not the library's.
   */
  const inside = (path: string) => within(realpathSync.native(root), path)

  function index(entry: Entry): void {
    byId.set(entry.id, entry)
    byRel.set(key(entry.rel), entry)
  }

  /** An entry, and for a folder the entries inside it, at any depth. */
  function withInside(entry: Entry): Entry[] {
    if (!entry.directory) return [entry]
    const prefix = key(entry.rel) + sep
    return [entry, ...[...byId.values()].filter((other) => key(other.rel).startsWith(prefix))]
  }

  function forget(entry: Entry): void {
    for (const gone of withInside(entry)) {
      byId.delete(gone.id)
      byRel.delete(key(gone.rel))
    }
  }

  /** Records that an entry, and everything inside a folder, is now at `rel`. */
  function reindex(entry: Entry, rel: string): void {
    const from = entry.rel
    for (const moved of withInside(entry)) {
      // Another entry can already be at the path this one left.
      if (byRel.get(key(moved.rel)) === moved) byRel.delete(key(moved.rel))
      moved.rel = moved === entry ? rel : join(rel, moved.rel.slice(from.length + 1))
      byRel.set(key(moved.rel), moved)
    }
  }

  function relOf(item: ProviderItem): string | null {
    // A name is one step of a path here. One made on another system can hold
    // a separator or be `..`, which would put the item in another folder, or
    // outside this one.
    if (/[\\/]/.test(item.name) || item.name === '.' || item.name === '..') return null
    if (item.parentId === null) return item.name
    const parent = byId.get(item.parentId)
    return parent ? join(parent.rel, item.name) : null
  }

  /**
   * Tells the daemon the folder took or dropped a file, as the macOS extension
   * does, and its next read asks for the files the folder holds. One that
   * fails is made up for by the read that follows each connect.
   */
  function changed(): void {
    daemon('mountChanged').catch((e) => logger.error('folder', 'hint_failed', { error: e }))
  }

  /** Whether the file holds bytes the daemon has not been sent. */
  function unsent(entry: Entry): boolean {
    const path = abs(entry.rel)
    return cloud.attributes(path)?.hydrated === true && signature(path) !== entry.sent
  }

  /** Makes the folder match one item of the library. */
  async function apply(item: ProviderItem): Promise<void> {
    const rel = relOf(item)
    if (rel === null) return
    const entry = byId.get(item.id)
    if (!entry) {
      // Not created when a file made here already has the name.
      if (!cloud.create(abs(rel), placeholder(item))) return
      index({
        id: item.id,
        rel,
        directory: item.kind === 'dir',
        version: item.contentVersion,
        sent: signature(abs(rel)),
      })
      return
    }
    if (entry.rel !== rel) {
      const there = byRel.get(key(rel))
      const own = parseIdentity(cloud.placeholder(abs(rel))?.identity ?? '').id === entry.id
      // The item's placeholder can be at the library's path already, with
      // the entry found at a copy of it that a program left behind.
      if (there || !own) {
        // Renaming over a file would delete it, and it may never have been sent.
        if (there ? there !== entry : existsSync(abs(rel))) {
          throw new Error('A file is already where the library moved this one')
        }
        if (!inside(abs(entry.rel)) || !inside(dirname(abs(rel)))) {
          throw new Error('The library moved a file through a link to outside the folder')
        }
        try {
          renameSync(abs(entry.rel), abs(rel))
        } catch (e) {
          // A program holding the file open without sharing its delete blocks
          // the move, and its close applies the item again.
          const code = (e as NodeJS.ErrnoException).code
          if (entry.directory || (code !== 'EBUSY' && code !== 'EPERM')) throw e
          entry.newer = item
          return
        }
      } else {
        // The copy's identity and signature are not this file's.
        const held = cloud.placeholder(abs(rel))
        entry.version = parseIdentity(held?.identity ?? '').version
        entry.sent = held?.inSync ? signature(abs(rel)) : ''
      }
      reindex(entry, rel)
    }
    if (entry.directory) return
    if (entry.version !== item.contentVersion) return replace(entry, item)
    // A version waiting for the file to close is out of date once the library
    // is back at the one the file holds.
    entry.newer = undefined
    // The version uploaded, and nothing was written to the file.
    if (
      item.uploaded &&
      inside(abs(rel)) &&
      !unsent(entry) &&
      cloud.placeholder(abs(rel))?.inSync === false
    ) {
      cloud.update(abs(rel), placeholder(item))
    }
  }

  /** Items whose folder is in the same batch wait for it, since a batch names them in no order. */
  async function applyAll(items: ProviderItem[]): Promise<void> {
    let waiting = items
    while (waiting.length > 0) {
      const ready = waiting.filter((item) => relOf(item) !== null)
      if (ready.length === 0) return
      for (const item of ready) {
        await apply(item).catch((e) =>
          logger.error('folder', 'apply_failed', { id: item.id, error: e }),
        )
      }
      const done = new Set(ready)
      waiting = waiting.filter((item) => !done.has(item))
    }
  }

  /**
   * Turns the file into a placeholder of another device's version, with no
   * bytes, so the next read fetches the new ones.
   */
  async function replace(entry: Entry, item: ProviderItem): Promise<void> {
    // A file saved here keeps its bytes.
    if (unsent(entry)) return
    const path = abs(entry.rel)
    if (!inside(path)) return
    const before = cloud.attributes(path)
    if (!before) return
    // A file in sync when `unsent` looked can be saved to before the update,
    // and the system then refuses the update rather than drop the save.
    const verify = cloud.placeholder(path)?.inSync === true
    // The system refuses to drop a pinned file's bytes.
    if (before.pinned) cloud.pin(path, false)
    let updated: boolean
    try {
      updated = cloud.update(path, placeholder(item), true, verify)
    } finally {
      // The file is now eligible for Free up space, which the user did not ask for.
      if (before.pinned && !cloud.pin(path, true))
        logger.warn('folder', 'repin_failed', { id: entry.id })
    }
    // A program has the file open, or saved to it. `closed` tries again.
    entry.newer = updated ? undefined : item
    if (!updated) return
    entry.version = item.contentVersion
    entry.sent = signature(path)
    if (before.hydrated) changed()
    if (before.pinned) cloud.hydrate(path)
  }

  /** Acts on what has happened to an entry's file: a pin, a request to free it. */
  async function settle(entry: Entry): Promise<void> {
    const path = abs(entry.rel)
    const attributes = cloud.attributes(path)
    if (!attributes || entry.directory) return
    if (entry.newer) await apply(entry.newer)
    else if (attributes.pinned && !attributes.hydrated) cloud.hydrate(path)
    // Free up space in Explorer marks the file unpinned and leaves removing
    // its bytes to the provider.
    else if (attributes.unpinned && attributes.hydrated && cloud.dehydrate(path) === 'done') {
      changed()
    }
  }

  /** Acts on a path that changed, which is how a file pinned or freed in Explorer shows. */
  async function examine(rel: string): Promise<void> {
    const entry = byRel.get(key(rel))
    if (entry) await settle(entry)
  }

  /** Every readable path in the folder, a folder before what is in it. */
  function* walk(
    dir = '',
    realRoot = realpathSync.native(root),
  ): Generator<{ rel: string; directory: boolean }> {
    for (const name of readdirSync(abs(dir))) {
      const rel = join(dir, name)
      if (!within(realRoot, abs(rel))) continue
      let directory: boolean
      try {
        // Not the listing's own file types, which call a placeholder folder a link.
        directory = statSync(abs(rel)).isDirectory()
      } catch (e) {
        // A link to nothing, for one. Skipped, or it would end every pass.
        logger.error('folder', 'unreadable', { error: e as Error })
        continue
      }
      yield { rel, directory }
      if (directory) yield* walk(rel, realRoot)
    }
  }

  /** Makes the entries what the folder's placeholders say. Nothing else is read. */
  function load(): void {
    byId.clear()
    byRel.clear()
    for (const { rel, directory } of walk()) {
      const held = cloud.placeholder(abs(rel))
      if (!held) continue
      const { id, version } = parseIdentity(held.identity)
      // A program's backup copy of a placeholder carries the same identity.
      if (byId.has(id)) continue
      // Not in sync is how Windows marks a file written to since.
      index({ id, rel, directory, version, sent: held.inSync ? signature(abs(rel)) : '' })
    }
  }

  /** Rebuilds the entries from the folder's placeholders and the daemon's list. */
  async function refresh(): Promise<string> {
    load()
    const items: ProviderItem[] = []
    let cursor: string | undefined
    let anchor: string | undefined
    while (anchor === undefined) {
      const page = await daemon<ProviderPage>(
        'list',
        WORKING_SET_ID,
        ...(cursor === undefined ? [] : [cursor]),
      )
      items.push(...page.items)
      cursor = page.cursor
      anchor = page.anchor
    }
    // Before the list is applied: an item the library replaced with another
    // of the same name would otherwise find the old placeholder at its path,
    // not be created, and then see the old one removed.
    const listed = new Set(items.map((item) => item.id))
    for (const entry of [...byId.values()]) if (!listed.has(entry.id)) remove(entry)
    await applyAll(items)
    return anchor
  }

  /** Removes an item the library no longer shows. */
  function remove(entry: Entry): void {
    forget(entry)
    if (existsSync(abs(entry.rel))) prune(cloud, root, abs(entry.rel))
  }

  /** Serves one read of a placeholder, a range from the daemon at a time. */
  async function serve(fetch: CloudEvent): Promise<void> {
    const { id, version } = parseIdentity(fetch.identity)
    const end = fetch.offset + fetch.length
    let offset = fetch.offset
    try {
      while (offset < end) {
        const dest = join(handoffDir, crypto.randomUUID())
        let served: ProviderRangeResult
        let data: Buffer
        try {
          served = await daemon<ProviderRangeResult>(
            'fetchRange',
            id,
            dest,
            offset,
            Math.min(FETCH_CHUNK, end - offset),
            version,
            // A placeholder holds ranges of one version, so another is refused.
            true,
          )
          if (served.bytes <= 0) throw new Error('The daemon served no bytes')
          // A daemon on Windows puts the range at the front of the file.
          data = readFileSync(dest)
        } finally {
          rmSync(dest, { force: true })
        }
        // Another device's version can take the placeholder while the daemon
        // answers, and these bytes would then be written into it.
        if (byId.get(id)?.version !== version) throw new Error('The file has a newer version')
        cloud.transfer(fetch, data, served.offset)
        offset = served.offset + served.bytes
      }
    } catch (e) {
      cloud.failTransfer(fetch, offset, end - offset)
      logger.error('folder', 'fetch_failed', { id, error: e as Error })
    }
    const entry = byId.get(id)
    if (entry && cloud.attributes(abs(entry.rel))?.hydrated) changed()
  }

  async function handle(event: CloudEvent): Promise<void> {
    const entry = byId.get(parseIdentity(event.identity).id)
    if (!entry) return
    switch (event.type) {
      case Callback.opened:
        opened.add(entry.id)
        return
      case Callback.closed:
        return settle(entry)
      case Callback.dehydrated:
        changed()
    }
  }

  /**
   * Answers one of the daemon's questions over the mount link. Not in turn
   * with the rest: the daemon gives up on an answer after a minute, and the
   * turn can be held for longer. `list` and `dehydrate` read the entries and
   * ask Windows, and every step that changes the entries does so without a
   * wait in the middle.
   */
  async function answer(verb: MountRequestFrame['verb'], stackIds: string[]): Promise<unknown> {
    const hydrated = (entry: Entry | undefined): entry is Entry =>
      entry !== undefined && !entry.directory && cloud.attributes(abs(entry.rel))?.hydrated === true
    // A file holding bytes other than its library version's is left out:
    // one waiting for a program to close it before taking another device's
    // version, and one saved here and not sent. The daemon records a listed
    // file as holding the version the library shows.
    if (verb === 'list') {
      return [...byId.values()]
        .filter((entry) => hydrated(entry) && !entry.newer && !unsent(entry))
        .map((entry) => entry.id)
    }
    const results: Record<string, string> = {}
    for (const id of stackIds) {
      const entry = byId.get(id)
      if (verb === 'dehydrate') {
        results[id] = hydrated(entry) ? cloud.dehydrate(abs(entry.rel)) : 'done'
      } else {
        // Handing a file's bytes back is a save, which is not sent yet.
        results[id] = hydrated(entry) ? 'failed' : 'not-hydrated'
      }
    }
    return results
  }

  // Everything else but a read runs one at a time, since each step reads the
  // entries and the folder and then changes both. A read only reports.
  let last: Promise<unknown> = Promise.resolve()
  function inTurn<T>(task: () => Promise<T>): Promise<T> {
    const run = last.then(task)
    last = run.catch(() => {})
    return run
  }

  // The daemon can ask over the mount link before the first rebuild has its
  // list. With no entries, a list would answer that the folder holds nothing,
  // and a dehydrate that every file is gone.
  load()

  return {
    refresh: () => inTurn(refresh),
    examine: (rel: string) => inTurn(() => examine(rel)),
    /** Applies one page of the daemon's change feed. */
    changes: (page: ProviderChanges) =>
      inTurn(async () => {
        for (const id of page.deletedIds) {
          const entry = byId.get(id)
          if (entry) remove(entry)
        }
        await applyAll(page.items)
      }),
    /**
     * Acts on one callback from Windows. `dropped` stands for callbacks
     * Windows made and the queue lost, so everything is rebuilt.
     */
    handle(event: CloudEvent | 'dropped'): Promise<void> {
      if (event === 'dropped') return inTurn(async () => void (await refresh()))
      return event.type === Callback.fetch ? serve(event) : inTurn(() => handle(event))
    },
    answer,
    /**
     * Tells the daemon which files were opened since the last call, to count
     * as used. Ones it could not be told, as while it restarts, go with the
     * next call, since a copy whose use goes uncounted can be freed early.
     */
    async touchOpened(): Promise<void> {
      const ids = [...opened]
      if (ids.length === 0) return
      opened.clear()
      try {
        await daemon('touch', ids)
      } catch (e) {
        for (const id of ids) opened.add(id)
        throw e
      }
    },
  }
}
