/*
 * The library's folder in File Explorer: what it holds, and what to do about
 * each change to it from either side.
 *
 * It does what the File Provider extension does on macOS, in the shape
 * Windows asks for. The library's side arrives as items the daemon lists and
 * as its change feed, and each one becomes a placeholder, a move, a new
 * version or a removal in the folder. The folder's side arrives three ways.
 * Windows calls back about a placeholder that was read, opened, closed,
 * renamed, deleted or dehydrated. A path that changed on disk is examined,
 * which finds a file created or saved there, one moved out, and one pinned or
 * freed in Explorer. And the daemon asks over its mount link for files to be
 * dehydrated, handed back or listed.
 *
 * Nothing is kept between runs. A placeholder's identity holds the item id
 * and the content version its bytes belong to, and Windows marks a file not
 * in sync when it is written to, so `refresh` rebuilds everything from the
 * folder and the daemon's list. That cannot tell which side renamed or
 * deleted something while the provider or the daemon was not running, so the
 * library's name and place win, and a file deleted here then comes back. A
 * save or a new file made in that time is sent.
 *
 * Not handled: an item whose name Windows cannot hold, or holds a path
 * separator, or whose path another item or a file made here already has,
 * including by a name that differs only in case, is left out of the folder.
 * A rename or a delete whose call to the daemon fails is not tried again, so
 * the next change to the item or the next rebuild puts the library's name
 * back or brings the file back. So does a rename to a path over 1,023
 * characters, which its callback cannot carry. A file put back from the
 * Recycle Bin is in the library's trash by then, and is taken for what is
 * left of an item the library no longer shows: removed, or sent as a new
 * file where it holds a save that was never sent. A file added to the
 * library on this PC outside the folder cannot be read here until it has
 * uploaded. A program's lock and temporary files (`~$*`, `*.tmp`) and
 * Explorer's own (`desktop.ini`, `Thumbs.db`) stay on this PC.
 */
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import {
  type ProviderChanges,
  type ProviderItem,
  type ProviderPage,
  type ProviderRangeResult,
  type ProviderWriteResult,
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
  /** How long a file's rename waits before the daemon is told. Shortened by tests. */
  renameHoldMs?: number
}

/**
 * A program that saves by swapping files renames the original to a backup
 * name, then renames the new file to the original's. The second rename can
 * come after the first one's callback, and with nothing at the old path the
 * first reads as the user renaming the file.
 */
const RENAME_HOLD_MS = 2_000

/**
 * What a placeholder's identity holds, a line each: the item id, the content
 * version its bytes belong to, and for a file saved here that has not
 * uploaded, its `signature` when the daemon was sent those bytes. Windows
 * marks such a file not in sync, as it marks one written to since, and the
 * signature is what tells the two apart after a restart.
 */
function parseIdentity(text: string): { id: string; version: string; sent: string } {
  const [id, version = '', sent = ''] = text.split('\n')
  return { id, version, sent }
}

function placeholder(item: ProviderItem, inSync = item.uploaded, sent = ''): Placeholder {
  const directory = item.kind === 'dir'
  return {
    identity: [item.id, item.contentVersion, ...(inSync || !sent ? [] : [sent])].join('\n'),
    size: item.size,
    createdAt: item.createdAt,
    modifiedAt: item.modifiedAt,
    directory,
    inSync: directory || inSync,
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

/** A program's lock and temporary files, and the files Explorer keeps in a folder for itself. */
function scratch(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.startsWith('~$') || lower.endsWith('.tmp') || ['desktop.ini', 'thumbs.db'].includes(lower)
  )
}

/**
 * Removes what is left of an item the library no longer shows. Returns false,
 * leaving it, where it holds bytes the daemon was never sent: a file that is
 * no placeholder, a placeholder saved to since, or a folder with either in
 * it.
 */
export function prune(cloud: CloudFiles, path: string): boolean {
  if (statSync(path).isDirectory()) {
    const emptied = readdirSync(path).map((name) => prune(cloud, join(path, name)))
    if (emptied.includes(false)) return false
  } else {
    const held = cloud.placeholder(path)
    if (!held || (cloud.attributes(path)?.hydrated && !held.inSync)) return false
  }
  rmSync(path, { recursive: true })
  return true
}

export function createFolder({
  root,
  handoffDir,
  cloud,
  daemon,
  renameHoldMs = RENAME_HOLD_MS,
}: FolderOptions) {
  const byId = new Map<string, Entry>()
  const byRel = new Map<string, Entry>()
  /** Files opened since `takeOpened` last returned them. */
  const opened = new Set<string>()
  // Windows names ignore case.
  const key = (rel: string) => rel.toLowerCase()
  const abs = (rel: string) => join(root, rel)

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

  /** The id of the folder holding `rel`, sending the daemon a folder it has not heard of. */
  async function parentId(rel: string): Promise<string | null> {
    const parent = dirname(rel)
    if (parent === '.') return null
    if (!byRel.has(key(parent))) await examine(parent)
    const entry = byRel.get(key(parent))
    if (!entry) throw new Error('The folder holding the file is not in the library')
    return entry.id
  }

  /**
   * Runs `send` with a copy of the file in the handoff folder. The daemon
   * takes the copy when it accepts the bytes, and one it did not take is
   * removed.
   */
  async function staged<T>(path: string, send: (copy: string) => Promise<T>): Promise<T> {
    const copy = join(handoffDir, crypto.randomUUID())
    copyFileSync(path, copy)
    try {
      return await send(copy)
    } finally {
      rmSync(copy, { force: true })
    }
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
      // Not created when a file made here already has the name. That file
      // is sent to the daemon, which answers with the item it becomes.
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
        renameSync(abs(entry.rel), abs(rel))
      }
      reindex(entry, rel)
    }
    if (entry.directory) return
    if (entry.version !== item.contentVersion) await replace(entry, item)
    // The version uploaded, and nothing was written to the file since it was sent.
    else if (item.uploaded && !unsent(entry) && cloud.placeholder(abs(rel))?.inSync === false) {
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
      waiting = waiting.filter((item) => !ready.includes(item))
    }
  }

  /**
   * Turns the file into a placeholder of another device's version, with no
   * bytes, so the next read fetches the new ones.
   */
  async function replace(entry: Entry, item: ProviderItem): Promise<void> {
    // A save made here goes to the daemon first, which orders the two
    // versions and answers with the one the file should hold.
    if (unsent(entry)) return save(entry)
    const path = abs(entry.rel)
    const before = cloud.attributes(path)
    if (!before) return
    // The system refuses to drop a pinned file's bytes.
    if (before.pinned) cloud.pin(path, false)
    let updated: boolean
    try {
      updated = cloud.update(path, placeholder(item), true)
    } finally {
      if (before.pinned) cloud.pin(path, true)
    }
    // A program has the file open. `closed` tries again.
    entry.newer = updated ? undefined : item
    if (!updated) return
    entry.version = item.contentVersion
    entry.sent = signature(path)
    if (before.hydrated) changed()
    if (before.pinned) cloud.hydrate(path)
  }

  /** Sends the file's bytes to the daemon as a new version. */
  async function save(entry: Entry): Promise<void> {
    const path = abs(entry.rel)
    // Copying a file whose bytes are not on disk has Windows fetch them
    // first, through this thread, which would wait on itself.
    if (!cloud.attributes(path)?.hydrated) return
    const sent = signature(path)
    const item = await staged(path, (copy) =>
      daemon<ProviderWriteResult>('write', entry.id, copy, entry.version),
    )
    // The bytes are the version the file started from, unedited, and another
    // device's version replaced it since, as when the daemon asks for a file
    // back. The daemon keeps the newer one, and the file takes it.
    if (item.stale) {
      entry.sent = sent
      return replace(entry, item)
    }
    entry.version = item.contentVersion
    entry.newer = undefined
    entry.sent = sent
    mark(path, item, sent)
    logger.info('folder', 'saved', { id: entry.id })
  }

  /**
   * Makes the file at `path` the item's placeholder. `sent` is the file's
   * signature when its bytes were read for the daemon. A file written to
   * since is left out of sync, and that write is the next save.
   */
  function mark(path: string, item: ProviderItem, sent: string): void {
    const next = placeholder(item, item.uploaded && signature(path) === sent, sent)
    // A file a program saved by replacing it is a plain one.
    if (cloud.placeholder(path)) cloud.update(path, next)
    else cloud.convert(path, next.identity, next.inSync)
  }

  /** Sends a file or folder made in the folder to the daemon. */
  async function add(rel: string, directory: boolean): Promise<void> {
    const path = abs(rel)
    const parent = await parentId(rel)
    const sent = signature(path)
    const create = (...file: string[]) =>
      daemon<ProviderItem>('create', parent, basename(rel), directory ? 'dir' : 'file', ...file)
    const item = directory ? await create() : await staged(path, create)
    mark(path, item, sent)
    index({ id: item.id, rel, directory, version: item.contentVersion, sent })
    logger.info('folder', 'added', { id: item.id })
  }

  /** Tells the daemon a file or folder was deleted here or moved out of the folder. */
  async function trash(entry: Entry): Promise<void> {
    forget(entry)
    const holding = holds.get(entry.id)
    // A backup the program deletes once it has swapped the new file in. The
    // trash waits with the rename, and goes only if nothing takes its place.
    if (holding) {
      holding.gone = true
      return
    }
    await daemon('trash', entry.id)
    logger.info('folder', 'trashed', { id: entry.id })
  }

  /** Acts on what has happened to an entry's file: a save, a pin, a request to free it. */
  async function settle(entry: Entry): Promise<void> {
    const path = abs(entry.rel)
    const attributes = cloud.attributes(path)
    if (!attributes || entry.directory) return
    if (entry.newer) await replace(entry, entry.newer)
    else if (attributes.hydrated && signature(path) !== entry.sent) await save(entry)
    else if (attributes.pinned && !attributes.hydrated) cloud.hydrate(path)
    // Free up space in Explorer marks the file unpinned and leaves removing
    // its bytes to the provider.
    else if (attributes.unpinned && attributes.hydrated && cloud.dehydrate(path) === 'done') {
      changed()
    }
  }

  /** Acts on whatever is at a path that changed. `rel` is under the root. */
  async function examine(rel: string): Promise<void> {
    const path = abs(rel)
    const entry = byRel.get(key(rel))
    const there = cloud.attributes(path) !== null
    // An entry with no file was moved out of the folder. Windows calls back
    // about a delete and about a rename inside the folder, and not about that.
    if (entry) return there ? settle(entry) : trash(entry)
    if (!there) return
    const held = cloud.placeholder(path)
    if (held) {
      // An entry's placeholder at a path the entry is not at was renamed,
      // and its callback has not been handled yet.
      if (byId.has(parseIdentity(held.identity).id)) return
      // Any other placeholder is what is left of an item the library no
      // longer shows. One holding bytes never sent stays, as a new file.
      const removed = prune(cloud, path)
      if (removed) return
    }
    const directory = statSync(path).isDirectory()
    if (!held && !directory && scratch(basename(rel))) return
    const swapped = directory ? undefined : [...holds.values()].find((h) => h.from === key(rel))
    if (swapped) return swappedIn(swapped, rel)
    await add(rel, directory)
    // A folder moved in from elsewhere arrives as one change.
    if (directory) for (const name of readdirSync(path)) await examine(join(rel, name))
  }

  /** Every readable path in the folder, a folder before what is in it. */
  function* walk(dir = ''): Generator<{ rel: string; directory: boolean }> {
    for (const name of readdirSync(abs(dir))) {
      const rel = join(dir, name)
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
      // The caller may have removed the folder it was just handed.
      if (directory && existsSync(abs(rel))) yield* walk(rel)
    }
  }

  /**
   * Examines every path in the folder. This is how a file created, saved,
   * pinned or freed while nothing was watching is found: before the provider
   * started, while the daemon was away, and when Windows had more changes
   * than it could report.
   */
  async function scan(): Promise<void> {
    for (const { rel } of walk()) {
      await examine(rel).catch((e) => logger.error('folder', 'examine_failed', { error: e }))
    }
  }

  /** Makes the entries what the folder's placeholders say. Nothing else is read. */
  function load(): void {
    byId.clear()
    byRel.clear()
    for (const { rel, directory } of walk()) {
      const held = cloud.placeholder(abs(rel))
      if (!held) continue
      const { id, version, sent } = parseIdentity(held.identity)
      // A program's backup copy of a placeholder carries the same identity.
      if (byId.has(id)) continue
      // In sync, the bytes on disk are the version's. Out of sync, they are
      // what the daemon has only if the identity names this state of them.
      index({ id, rel, directory, version, sent: held.inSync ? signature(abs(rel)) : sent })
    }
  }

  /** Rebuilds the entries from the folder's placeholders and the daemon's list, then scans. */
  async function refresh(): Promise<string> {
    // The library's names win in a rebuild, as for a rename that failed.
    holds.clear()
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
    for (const entry of [...byId.values()]) if (!listed.has(entry.id)) await remove(entry.id)
    await applyAll(items)
    await scan()
    return anchor
  }

  /** Removes an item the library no longer shows. */
  async function remove(id: string): Promise<void> {
    const entry = byId.get(id)
    if (!entry) return
    forget(entry)
    if (cloud.attributes(abs(entry.rel))) await examine(entry.rel)
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
    const rel = relative(root, event.path)
    switch (event.type) {
      case Callback.opened:
        opened.add(entry.id)
        return
      case Callback.closed:
        return settle(entry)
      case Callback.dehydrated:
        changed()
        return
      case Callback.deleted:
        // Not the entry's own file: a program's backup copy of it.
        if (key(rel) !== key(entry.rel)) return
        // A program that saves by writing a new file over the old one
        // deletes the placeholder, and the new file is the save.
        return examine(entry.rel)
      case Callback.renamed: {
        // A path too long for the callback to carry. The rebuild finds the
        // placeholder by its identity and gives it the library's name back.
        if (!event.path) return void (await refresh())
        // A path outside the folder is a move out of it.
        if (rel.startsWith('..') || isAbsolute(rel)) return trash(entry)
        // A program that saves by swapping a new file in renames the
        // placeholder to its backup name, and the new file is the save. A
        // placeholder at the old path is some other item, moved there since.
        const old = abs(entry.rel)
        if (key(rel) !== key(entry.rel) && cloud.attributes(old) && !cloud.placeholder(old)) {
          return settle(entry)
        }
        const from = entry.rel
        // Before the daemon is told, so that a change at either path finds the
        // entry where the file is, and a call that fails leaves it there.
        reindex(entry, rel)
        if (entry.directory) return sendRename(entry)
        hold(entry, from)
      }
    }
  }

  /** Tells the daemon of a rename made here, and takes the item it answers with. */
  async function sendRename(entry: Entry): Promise<void> {
    const item = await daemon<ProviderItem>(
      'rename',
      entry.id,
      await parentId(entry.rel),
      basename(entry.rel),
    )
    // The daemon merges a file renamed onto another's name into that file.
    if (item.id !== entry.id) {
      byId.delete(entry.id)
      entry.id = item.id
      byId.set(item.id, entry)
      const inSync = cloud.placeholder(abs(entry.rel))?.inSync ?? false
      cloud.update(abs(entry.rel), placeholder(item, inSync, entry.sent))
    }
    logger.info('folder', 'renamed', { id: entry.id })
  }

  /**
   * Renames of files the daemon has not been told of yet, by item id, with the
   * path each left. `gone` is set when the file was deleted while held.
   */
  const holds = new Map<string, { entry: Entry; from: string; gone: boolean }>()

  /** Tells the daemon of a file's rename once `renameHoldMs` passes with no file swapped in. */
  function hold(entry: Entry, from: string): void {
    const holding = { entry, from: key(from), gone: false }
    holds.set(entry.id, holding)
    setTimeout(() => {
      inTurn(async () => {
        // Taken by a swap, by a rebuild, or by a later rename of the same file.
        if (holds.get(entry.id) !== holding) return
        holds.delete(entry.id)
        if (!holding.gone) return sendRename(entry)
        await daemon('trash', entry.id)
        logger.info('folder', 'trashed', { id: entry.id })
      }).catch((e) => logger.error('folder', 'rename_failed', { id: entry.id, error: e }))
    }, renameHoldMs)
  }

  /** Sends a file that appeared where a held rename's file was as a save of that file. */
  async function swappedIn(
    holding: { entry: Entry; from: string; gone: boolean },
    rel: string,
  ): Promise<void> {
    const { entry } = holding
    holds.delete(entry.id)
    // A deleted backup took the entry out of the index.
    if (holding.gone) index(entry)
    // The backup, where it is still there, keeps the same identity, which
    // makes it a copy of this file that nothing reads.
    reindex(entry, rel)
    await save(entry)
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
      } else if (hydrated(entry)) {
        results[id] = 'asked'
        void inTurn(() => save(entry)).catch((e) =>
          logger.error('folder', 'resend_failed', { id, error: e }),
        )
      } else {
        results[id] = 'not-hydrated'
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

  // The daemon can ask over the mount link, and the folder's watch can see a
  // change, before the first rebuild has the daemon's list. With no entries,
  // a list would answer that the folder holds nothing, a dehydrate that every
  // file is gone, and a changed path would read as a placeholder of an item
  // the library no longer shows.
  load()

  return {
    refresh: () => inTurn(refresh),
    scan: () => inTurn(scan),
    examine: (rel: string) => inTurn(() => examine(rel)),
    /** Applies one page of the daemon's change feed. */
    changes: (page: ProviderChanges) =>
      inTurn(async () => {
        for (const id of page.deletedIds) await remove(id)
        await applyAll(page.items)
      }),
    /**
     * Acts on one callback from Windows. `dropped` stands for callbacks
     * Windows made and the queue lost, any of which may be a rename or a
     * delete, so everything is rebuilt before a path is examined again.
     */
    handle(event: CloudEvent | 'dropped'): Promise<void> {
      if (event === 'dropped') return inTurn(async () => void (await refresh()))
      return event.type === Callback.fetch ? serve(event) : inTurn(() => handle(event))
    },
    answer,
    /** The files opened since the last call, for the daemon to count as used. */
    takeOpened(): string[] {
      const ids = [...opened]
      opened.clear()
      return ids
    },
  }
}
