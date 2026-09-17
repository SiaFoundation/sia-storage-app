/*
 * The surface an OS storage-provider shell drives: describe one file or
 * folder, list a folder a page at a time, say what changed since an anchor,
 * and land what the user did in the folder back in the library.
 *
 * A shell (a macOS File Provider extension, a Windows sync root, a FUSE mount)
 * has no database and caches nothing. It turns each OS callback into one call
 * here and renders the result, so every translation between the library's
 * model and the flat item the OS understands is decided in this file: which
 * row an identifier names, what a folder holds, and the transfer flags a file
 * browser draws as badges.
 *
 * It reads through the other namespaces and its own queries, and owns no
 * storage.
 */
import type { DatabaseAdapter } from '../../adapters/db'
import * as ops from '../../db/operations'
import { UNFILED_DIRECTORY_ID } from '../../db/operations'
import type { Directory } from '../../db/operations'
import { getMimeTypeFromExtension } from '../../lib/fileTypes'
import { uniqueId } from '../../lib/uniqueId'
import type { FsIOAdapter } from '../../services/fsFileUri'
import type { FileRecordRow } from '../../types/files'
import {
  directoryProviderId,
  parseDirectoryProviderId,
  WORKING_SET_ID,
  type ProviderChanges,
  type ProviderItem,
  type ProviderPage,
} from '../../types/provider'
import type { AppService } from '../service'
import { ANCHOR_START, formatAnchor, parseAnchor, type ProviderAnchor } from '../providerAnchor'

/** Rows per page. */
const MAX_PAGE_SIZE = 500
/** Marks a working set cursor as still working through folders. */
const FOLDER_CURSOR = 'dirs:'

export type ProviderNamespaceDeps = {
  getService: () => AppService
  db: DatabaseAdapter
  fsIO: FsIOAdapter
  /**
   * Absolute directory both this process and the OS shell can reach. Every
   * handoff path is checked against it, so a shell can only ever name a file
   * inside the area the host chose for it. Absent means no shell is attached
   * and every handoff call fails closed.
   */
  handoffDir?: string
  /** Lowered by tests, which cannot afford to write a full page of rows. */
  maxPageSize?: number
}

/** Transfer flags for a batch of files, resolved in one pass over the library. */
type TransferFlags = {
  uploaded: Set<string>
  uploading: Map<string, number>
  downloading: Map<string, number>
}

export function buildProviderNamespace(deps: ProviderNamespaceDeps): AppService['provider'] {
  const { getService, db, fsIO, handoffDir } = deps
  const pageSize = deps.maxPageSize ?? MAX_PAGE_SIZE

  /**
   * Resolves a folder id to the directory path the library indexes by.
   *
   * Three answers, because the caller has to tell them apart: a path, `null`
   * for the mount root which has no directory row, and `undefined` for an id
   * naming a directory that is not there.
   */
  async function folderPath(folderId: string | null): Promise<string | null | undefined> {
    if (folderId === null) return null
    const directoryId = parseDirectoryProviderId(folderId)
    if (directoryId === null) return undefined
    const dir = await getService().directories.getById(directoryId)
    return dir ? dir.path : undefined
  }

  /**
   * Reads the flags a file browser draws as cloud badges for a set of files.
   *
   * Object presence is one batched query rather than one per file: a folder of
   * a few thousand items would otherwise issue a few thousand round trips on
   * every enumeration. In-flight state comes from the upload and download
   * managers' in-memory maps, which cost nothing to read.
   */
  async function transferFlags(fileIds: string[]): Promise<TransferFlags> {
    const service = getService()
    const uploads = service.uploads.getState()
    const downloads = service.downloads.getState()

    const uploading = new Map<string, number>()
    for (const id of fileIds) {
      const entry = uploads.uploads[id]
      if (entry && entry.status !== 'done' && entry.status !== 'error') {
        uploading.set(id, entry.progress ?? 0)
      }
    }

    const downloading = new Map<string, number>()
    for (const id of fileIds) {
      const entry = downloads.downloads[id]
      if (entry && entry.status !== 'done' && entry.status !== 'error') {
        downloading.set(id, entry.progress ?? 0)
      }
    }

    const refs = await service.localObjects.getRefsForFiles(fileIds)
    return {
      uploaded: new Set(fileIds.filter((id) => (refs[id]?.length ?? 0) > 0)),
      uploading,
      downloading,
    }
  }

  function fileToItem(
    row: FileRecordRow & { fsExists?: number },
    parentId: string | null,
    flags: TransferFlags,
  ): ProviderItem {
    const uploading = flags.uploading.get(row.id)
    const downloading = flags.downloading.get(row.id)
    return {
      id: row.id,
      parentId,
      name: row.name,
      kind: 'file',
      mimeType: row.type,
      size: row.size,
      createdAt: row.createdAt,
      modifiedAt: row.updatedAt,
      // The content hash is the only value that moves exactly when the bytes
      // do; updatedAt also moves on a rename, which would make the OS discard
      // a cached copy it could have kept.
      contentVersion: row.hash,
      // Composed from the fields it tracks rather than from updatedAt alone.
      // The edit clock has millisecond resolution, so a rename landing in the
      // same millisecond as the previous write leaves it unchanged and the OS
      // keeps showing the old name indefinitely.
      metadataVersion: [row.updatedAt, row.name, row.size, row.type, parentId ?? ''].join(':'),
      uploaded: flags.uploaded.has(row.id),
      uploading: uploading !== undefined,
      downloaded: (row.fsExists ?? 0) === 1,
      downloading: downloading !== undefined,
      progress: uploading ?? downloading ?? 0,
    }
  }

  function directoryToItem(dir: Directory, parentId: string | null): ProviderItem {
    return {
      id: directoryProviderId(dir.id),
      parentId,
      name: dir.name,
      kind: 'dir',
      mimeType: '',
      size: 0,
      createdAt: dir.createdAt,
      modifiedAt: dir.createdAt,
      contentVersion: dir.id,
      // Stable across ancestor renames: a descendant's name and parent id do
      // not change when a folder above it moves, so redelivering it is a
      // no-op at the OS instead of a metadata re-apply per row.
      metadataVersion: JSON.stringify([dir.name, parentId ?? '']),
      // A folder is never a transfer, so it carries no badge.
      uploaded: true,
      uploading: false,
      downloaded: true,
      downloading: false,
      progress: 0,
    }
  }

  async function itemsForFiles<T extends FileRecordRow & { fsExists?: number }>(
    rows: T[],
    parentIdFor: (row: T) => string | null,
  ): Promise<ProviderItem[]> {
    if (rows.length === 0) return []
    const flags = await transferFlags(rows.map((r) => r.id))
    return rows.map((row) => fileToItem(row, parentIdFor(row), flags))
  }

  /**
   * The parent a row belongs to now, which is not always the folder that was
   * asked about: a change feed can span folders, and a file that moved between
   * two of them is reported carrying its new parent.
   */
  function parentOf(row: { directoryId: string | null }): string | null {
    return row.directoryId ? directoryProviderId(row.directoryId) : null
  }

  /** The directory row id for a path, or null when the path names nothing. */
  async function dirIdFor(path: string): Promise<string | null> {
    const dir = await getService().directories.getByPath(path)
    return dir ? dir.id : null
  }

  /** This database's feed epoch, immutable for its lifetime. */
  let feedEpoch: string | null = null
  async function epoch(): Promise<string> {
    if (feedEpoch === null) feedEpoch = (await ops.queryFeedMeta(db)).epoch
    return feedEpoch
  }

  /**
   * Ids are base36, and '~' sorts above every one of them, so a cursor of
   * (seq, PAST_ALL_IDS) means "past everything at this sequence". Minted
   * anchors use it: (seq, '') would sit before the ids written at the
   * captured high-water and re-deliver the newest rows on every first delta.
   */
  const PAST_ALL_IDS = '~'

  /**
   * The working-set folder listing's cursor: the last path served, hex
   * encoded because paths may contain the delimiter (hex rather than
   * base64 keeps this file free of Node's Buffer, which mobile bundles),
   * plus the feed position captured on the first page. The final file page
   * returns that position as the delta anchor, so the shell's first change
   * request covers everything that happened during the listing;
   * near-boundary duplicates are the safe direction, and the delta drain
   * is what heals mid-listing mutations.
   */
  function encodePath(path: string): string {
    return Array.from(new TextEncoder().encode(path), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
  }

  function decodePath(hex: string): string | null {
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) return null
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    }
    return new TextDecoder().decode(bytes)
  }

  function parseFolderCursor(
    cursor: string | undefined,
  ): { afterPath: string; startSeq: number } | null {
    if (cursor === undefined) return { afterPath: '', startSeq: -1 }
    if (!cursor.startsWith(FOLDER_CURSOR)) return null
    const [encoded, seq] = cursor.slice(FOLDER_CURSOR.length).split(':')
    if (encoded === undefined || seq === undefined || !/^\d+$/.test(seq)) return null
    const startSeq = Number.parseInt(seq, 10)
    if (!Number.isSafeInteger(startSeq)) return null
    const afterPath = decodePath(encoded)
    if (afterPath === null) return null
    return { afterPath, startSeq }
  }

  /**
   * One page of the library's folders, in path order: a strict prefix sorts
   * before its extensions, so every parent is served before its own
   * descendants, which the OS needs because it may drop a child whose
   * parent it has not met.
   */
  async function listWorkingSetFolders(afterPath: string, startSeq: number): Promise<ProviderPage> {
    const started = startSeq >= 0 ? startSeq : (await ops.queryFeedMeta(db)).seq
    const directories = await ops.queryDirectoriesAfterPath(db, afterPath, pageSize)
    const items = directories.map((dir) =>
      directoryToItem(dir, dir.parentId ? directoryProviderId(dir.parentId) : null),
    )

    const last = directories[directories.length - 1]
    const cursor =
      directories.length === pageSize && last
        ? `${FOLDER_CURSOR}${encodePath(last.path)}:${started}`
        : await fileCursor(ANCHOR_START, started)
    return { items, cursor }
  }

  /**
   * The file phase's cursor: the anchor's fourth segment carries the
   * listing's start position. The delta paths never read the segment, so
   * only this listing consumes it.
   */
  async function fileCursor(
    position: { feedSeq: number; id: string },
    startSeq: number,
  ): Promise<string> {
    return formatAnchor(await epoch(), position, String(startSeq))
  }

  function expiredResponse(e: string): ProviderChanges {
    return {
      items: [],
      deletedIds: [],
      anchor: formatAnchor(e, ANCHOR_START),
      hasMore: false,
      expired: true,
    }
  }

  /**
   * Every folder at once: the whole library's deltas on one anchor, the
   * backbone the OS polls without any folder open. Folders ride the same
   * feed as files: created and renamed rows past the cursor become items,
   * and destructions come from the ledger, because the dead row itself is
   * gone.
   */
  async function workingSetChanges(
    e: string,
    since: ProviderAnchor,
    highWater: number,
  ): Promise<ProviderChanges> {
    const [dirRows, deletions, filePage] = await Promise.all([
      ops.queryDirectoryChangesSince(db, since, pageSize),
      ops.queryDeletedDeparturesSince(db, since, pageSize),
      ops.queryProviderChanges(db, null, since, pageSize),
    ])
    // One ordered stream: every entry keyed (feedSeq, id), cut at the page
    // budget, cursor = the last key taken. Each source read the same lower
    // bound with the same limit, so nothing below the cut can be missing.
    // The reads issue in one synchronous tick; an await between them would
    // let a write commit under an already-read source and above the cut.
    type Kind = 'dir' | 'deletedDir' | 'deletedFile' | 'file'
    const entries: { feedSeq: number; id: string; kind: Kind }[] = [
      ...dirRows.map((r) => ({ feedSeq: r.feedSeq, id: r.id, kind: 'dir' as Kind })),
      ...deletions.map((r) => ({
        feedSeq: r.feedSeq,
        id: r.id,
        kind: (r.kind === 'dir' ? 'deletedDir' : 'deletedFile') as Kind,
      })),
      ...filePage.changed.map((r) => ({ feedSeq: r.feedSeq, id: r.id, kind: 'file' as Kind })),
      ...filePage.removed.map((r) => ({
        feedSeq: r.feedSeq,
        id: r.id,
        kind: 'deletedFile' as Kind,
      })),
    ]
    entries.sort((a, b) => a.feedSeq - b.feedSeq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const page = entries.slice(0, pageSize)
    const last = page[page.length - 1]

    const dirById = new Map(dirRows.map((r) => [r.id, r]))
    const fileById = new Map(filePage.changed.map((r) => [r.id, r]))
    const pageDirs = page.flatMap((entry) => {
      const dir = entry.kind === 'dir' ? dirById.get(entry.id) : undefined
      return dir ? [dir] : []
    })

    const fileRows: typeof filePage.changed = []
    const deletedIds: string[] = []
    for (const entry of page) {
      if (entry.kind === 'deletedDir') deletedIds.push(directoryProviderId(entry.id))
      else if (entry.kind === 'deletedFile') deletedIds.push(entry.id)
      else if (entry.kind === 'file') {
        const row = fileById.get(entry.id)
        if (row) fileRows.push(row)
      }
    }
    // Delivery order, not cursor order: folders first, parents before
    // their descendants by path, then files, because the OS may drop an
    // item whose parent it has not met. The cursor cut above is what
    // guarantees nothing is lost; this only arranges the page.
    pageDirs.sort((a, b) => (a.path < b.path ? -1 : 1))
    const dirItems = pageDirs.map((dir) =>
      directoryToItem(
        {
          id: dir.id,
          path: dir.path,
          name: ops.directoryDisplayName(dir.path),
          createdAt: dir.createdAt,
          parentId: dir.parentId,
        },
        dir.parentId ? directoryProviderId(dir.parentId) : null,
      ),
    )
    const items = [...dirItems, ...(await itemsForFiles(fileRows, parentOf))]
    return {
      items,
      deletedIds,
      anchor: last
        ? formatAnchor(e, { feedSeq: last.feedSeq, id: last.id })
        : formatAnchor(e, { feedSeq: highWater, id: PAST_ALL_IDS }),
      hasMore: page.length === pageSize,
      expired: false,
    }
  }

  /** One folder's deltas, on the same cursor mechanics as the working set. */
  async function folderChanges(
    folderId: string | null,
    anchor: string,
    e: string,
    since: ProviderAnchor,
    highWater: number,
  ): Promise<ProviderChanges> {
    const empty = { items: [], deletedIds: [], anchor, hasMore: false, expired: false }
    const path = await folderPath(folderId)
    if (path === undefined) return empty

    // The root scope has three spellings, mapped once: child folders hang
    // off parentId NULL, files off the unfiled sentinel, and ledger rows
    // off '' (a NULL ledger key would never REPLACE-compact).
    let dirScope: string | null = null
    let fileScope: string = UNFILED_DIRECTORY_ID
    let departKey = ''
    if (path !== null) {
      const idFor = await dirIdFor(path)
      if (idFor === null) return empty
      dirScope = idFor
      fileScope = idFor
      departKey = idFor
    }

    const [childDirs, departures, filePage] = await Promise.all([
      ops.queryDirectoryChangesForParent(db, dirScope, since, pageSize),
      ops.queryDeparturesForParent(db, departKey, since, pageSize),
      ops.queryProviderChanges(db, fileScope, since, pageSize),
    ])
    // One ordered stream, cut and cursored exactly like the working set:
    // every source read the same lower bound with the same limit, so
    // nothing below the cut can be missing.
    type Kind = 'dir' | 'file' | 'removedFile' | 'departure'
    const entries: { feedSeq: number; id: string; kind: Kind }[] = [
      ...childDirs.map((r) => ({ feedSeq: r.feedSeq, id: r.id, kind: 'dir' as Kind })),
      ...filePage.changed.map((r) => ({ feedSeq: r.feedSeq, id: r.id, kind: 'file' as Kind })),
      ...filePage.removed.map((r) => ({
        feedSeq: r.feedSeq,
        id: r.id,
        kind: 'removedFile' as Kind,
      })),
      ...departures.map((r) => ({ feedSeq: r.feedSeq, id: r.id, kind: 'departure' as Kind })),
    ]
    entries.sort((a, b) => a.feedSeq - b.feedSeq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const page = entries.slice(0, pageSize)
    const last = page[page.length - 1]

    const dirById = new Map(childDirs.map((r) => [r.id, r]))
    const fileById = new Map(filePage.changed.map((r) => [r.id, r]))
    const departureById = new Map(departures.map((r) => [r.id, r]))
    const pageDirs: typeof childDirs = []
    const fileRows: typeof filePage.changed = []
    const removedIds = new Set<string>()
    const departedIds: string[] = []
    for (const entry of page) {
      if (entry.kind === 'dir') {
        const dir = dirById.get(entry.id)
        if (dir) pageDirs.push(dir)
      } else if (entry.kind === 'file') {
        const row = fileById.get(entry.id)
        if (row) fileRows.push(row)
      } else if (entry.kind === 'removedFile') {
        removedIds.add(entry.id)
      } else {
        departedIds.push(entry.id)
      }
    }

    // A departure never delivers from its own row. To the OS a removed id
    // is a domain-wide deletion, so an id that merely left this folder must
    // arrive as an updated item carrying its new parent, and only current
    // state can tell that from "moved away, then destroyed". An id that is
    // a live child again in this same page is already delivered above.
    const live = new Set([...pageDirs.map((d) => d.id), ...fileRows.map((r) => r.id)])
    const departedFiles: string[] = []
    const departedDirs: string[] = []
    for (const id of departedIds) {
      if (live.has(id) || removedIds.has(id)) continue
      if (departureById.get(id)?.kind === 'dir') departedDirs.push(id)
      else departedFiles.push(id)
    }
    const movedFileRows: typeof filePage.changed = []
    const fileStates = await ops.queryProviderRowsByIds(db, departedFiles)
    const fileStateById = new Map(fileStates.map((r) => [r.id, r]))
    for (const id of departedFiles) {
      const row = fileStateById.get(id)
      if (row && row.visible === 1) movedFileRows.push(row)
      else removedIds.add(id)
    }
    const dirStates = await ops.queryDirectoriesByIds(db, departedDirs)
    const dirStateById = new Map(dirStates.map((d) => [d.id, d]))
    const movedDirItems: ProviderItem[] = []
    for (const id of departedDirs) {
      const dir = dirStateById.get(id)
      if (dir) {
        movedDirItems.push(
          directoryToItem(dir, dir.parentId ? directoryProviderId(dir.parentId) : null),
        )
      } else {
        removedIds.add(directoryProviderId(id))
      }
    }

    const items = [
      ...pageDirs.map((dir) =>
        directoryToItem(
          {
            id: dir.id,
            path: dir.path,
            name: ops.directoryDisplayName(dir.path),
            createdAt: dir.createdAt,
            parentId: dir.parentId,
          },
          folderId,
        ),
      ),
      ...movedDirItems,
      ...(await itemsForFiles([...fileRows, ...movedFileRows], parentOf)),
    ]
    return {
      items,
      deletedIds: [...removedIds],
      anchor: last
        ? formatAnchor(e, { feedSeq: last.feedSeq, id: last.id })
        : formatAnchor(e, { feedSeq: highWater, id: PAST_ALL_IDS }),
      hasMore: page.length === pageSize,
      expired: false,
    }
  }

  /**
   * Rejects any handoff path outside the directory the host nominated.
   *
   * The shell is a different trust domain, so an unchecked path would name any
   * file the daemon can reach. `..` resolves before comparing and a separator
   * is required after the prefix, so a sibling name cannot pass. A path is text
   * here, so a planted symlink passes and is refused in the adapter, the only
   * place it is still distinguishable from what it points at.
   */
  function requireHandoffPath(candidate: string): string {
    if (!handoffDir) {
      throw new Error('No handoff directory is configured; this host cannot exchange files by path')
    }
    const resolved = normalizePath(candidate)
    const root = normalizePath(handoffDir)
    if (resolved !== root && !resolved.startsWith(`${root}/`)) {
      throw new Error(`Handoff path is outside ${root}`)
    }
    return resolved
  }

  function requireExport(): NonNullable<FsIOAdapter['exportTo']> {
    if (!fsIO.exportTo) {
      throw new Error('This host cannot place file bytes at a path')
    }
    return fsIO.exportTo
  }

  /** Resolves a file's bytes into managed storage, downloading them if absent. */
  async function ensureLocal(fileId: string): Promise<{ id: string; type: string }> {
    const service = getService()
    const file = await service.files.getById(fileId)
    if (!file) throw new Error(`No file with id ${fileId}`)
    const target = { id: file.id, type: file.type }
    if (await service.fs.getFileUri(target)) return target
    await service.downloads.downloadFile(fileId)
    if (!(await service.fs.getFileUri(target))) {
      throw new Error(`Download did not produce local bytes for ${fileId}`)
    }
    return target
  }

  /** Reads one item. Hoisted because other verbs read back through it. */
  async function item(id: string): Promise<ProviderItem | null> {
    const service = getService()
    const directoryId = parseDirectoryProviderId(id)
    if (directoryId !== null) {
      const dir = await service.directories.getById(directoryId)
      if (!dir) return null
      return directoryToItem(dir, dir.parentId ? directoryProviderId(dir.parentId) : null)
    }

    const row = await ops.queryProviderItem(db, id)
    if (!row) return null
    const [found] = await itemsForFiles([row], parentOf)
    return found ?? null
  }

  return {
    item,

    async list(folderId, cursor) {
      /*
       * The whole library: what the system is told about without anyone having
       * browsed to it, because an extension tracking nothing owes it everything.
       * Folders first a page at a time, then files, so no reply is unbounded.
       * The file phase pages on the change cursor the delta feed uses, so a
       * client that reads the set and then follows changes never translates
       * between two cursor spaces.
       */
      if (folderId === WORKING_SET_ID) {
        const folderPage = parseFolderCursor(cursor)
        if (folderPage !== null) {
          return listWorkingSetFolders(folderPage.afterPath, folderPage.startSeq)
        }

        const parsed = cursor === undefined ? null : parseAnchor(cursor, await epoch())
        // An unreadable file-phase cursor restarts the listing from the top.
        // Reachable: a wipe mid-listing changes the epoch, and the shell's
        // in-flight cursor fails the check.
        if (parsed === null) return listWorkingSetFolders('', -1)
        const startSeq = /^\d+$/.test(parsed.startSeq) ? Number.parseInt(parsed.startSeq, 10) : 0
        const page = await ops.queryProviderChanges(db, null, parsed, pageSize)
        const items = await itemsForFiles(page.changed, parentOf)
        // The final page hands over the position captured when the listing
        // began, so the first delta request re-covers the whole listing
        // window; duplicates are the safe direction.
        return page.hasMore
          ? { items, cursor: await fileCursor(page.cursor, startSeq) }
          : { items, anchor: formatAnchor(await epoch(), { feedSeq: startSeq, id: PAST_ALL_IDS }) }
      }

      const path = await folderPath(folderId)
      // A folder that vanished between the OS listing it and asking for its
      // contents reads as empty. Reporting an error instead makes a file
      // browser show a failure for a folder the user already deleted.
      if (path === undefined) return { items: [] }

      // Subfolders page first, then files, each on a name keyset rather than
      // an offset, because an offset page re-skips every prior row and a
      // 100k-file folder pays that per page: `d:<hexSortKey>:<id>:<startSeq>`
      // pages children and `k:<hexSortKey>:<id>:<startSeq>` pages files. A
      // page that exhausts the children fills its remainder with the first
      // files, so a folder with few subfolders lists in one reply. The feed
      // position is captured before the first page and carried through, so
      // the final page's anchor covers the whole listing window; an
      // unreadable cursor restarts the listing, which re-delivers
      // idempotently.
      const dirPage = /^d:([0-9a-f]*):([^:]+):(\d+)$/.exec(cursor ?? '')
      const filePage = /^k:([0-9a-f]*):([^:]+):(\d+)$/.exec(cursor ?? '')
      const carried = dirPage?.[3] ?? filePage?.[3]
      const startSeq =
        carried !== undefined && Number.isSafeInteger(Number.parseInt(carried, 10))
          ? Number.parseInt(carried, 10)
          : (await ops.queryFeedMeta(db)).seq

      const scopeId = path === null ? UNFILED_DIRECTORY_ID : ((await dirIdFor(path)) ?? null)
      if (scopeId === null) return { items: [] }

      const items: ProviderItem[] = []
      let fileAfter: { nameSortKey: string; id: string } | null = null
      let fileBudget = pageSize
      if (filePage === null) {
        const after =
          dirPage === null ? null : { nameSortKey: decodePath(dirPage[1]) ?? '', id: dirPage[2] }
        const children = await ops.queryDirectoriesByParent(
          db,
          path === null ? null : scopeId,
          after,
          pageSize,
        )
        items.push(...children.map((dir) => directoryToItem(dir, folderId)))
        const last = children[children.length - 1]
        if (children.length === pageSize && last) {
          return { items, cursor: `d:${encodePath(last.nameSortKey)}:${last.id}:${startSeq}` }
        }
        fileBudget = pageSize - children.length
      } else {
        fileAfter = { nameSortKey: decodePath(filePage[1]) ?? '', id: filePage[2] }
      }

      const rows = await ops.queryProviderFolderFiles(db, scopeId, fileAfter, fileBudget)
      items.push(...(await itemsForFiles(rows, () => folderId)))

      if (rows.length === fileBudget && rows.length > 0) {
        const last = rows[rows.length - 1]
        return { items, cursor: `k:${encodePath(last.nameSortKey)}:${last.id}:${startSeq}` }
      }
      // The scope's first valid anchor: without it a cold enumerator would
      // expire, relist, and expire again forever, since only anchors this
      // namespace mints can pass the epoch check.
      const anchor = formatAnchor(await epoch(), { feedSeq: startSeq, id: PAST_ALL_IDS })
      return { items, anchor }
    },

    async changes(folderId, anchor) {
      const e = await epoch()
      const since = parseAnchor(anchor, e)
      // Another library's anchor, or noise: one expiry, the shell relists,
      // and the listing mints a fresh anchor.
      if (since === null) return expiredResponse(e)
      // The high-water mark is read before the window queries on purpose: a
      // window verified empty afterwards proves nothing landed in
      // (since, meta.seq], so advancing an idle anchor to meta.seq skips
      // nothing. Anchors that track the present are what make the departure
      // ledger prunable: below the horizon means "has not polled since".
      const meta = await ops.queryFeedMeta(db)
      if (since.feedSeq < meta.horizon) return expiredResponse(e)
      return folderId === WORKING_SET_ID
        ? workingSetChanges(e, since, meta.seq)
        : folderChanges(folderId, anchor, e, since, meta.seq)
    },

    async fetch(id, destPath) {
      const dest = requireHandoffPath(destPath)
      const target = await ensureLocal(id)
      const bytes = await requireExport()(target, dest)
      const fetched = await item(id)
      if (!fetched) throw new Error(`No file with id ${id}`)
      return { bytes, item: fetched }
    },

    async progress(id) {
      const service = getService()
      const download = service.downloads.getState().downloads[id]
      if (download) {
        // A download reports a fraction and never a byte count, so the size
        // has to come from the row. Reported in bytes anyway: a shell drawing
        // a progress bar out of these two numbers has no way to know which
        // unit it was handed.
        const file = await service.files.getById(id)
        const total = file?.size ?? null
        return { received: total === null ? 0 : Math.round(download.progress * total), total }
      }
      const upload = service.uploads.getState().uploads[id]
      if (upload) {
        return { received: Math.round(upload.progress * upload.size), total: upload.size }
      }
      return { received: 0, total: null }
    },

    async create(parentId, name, kind, srcPath) {
      const service = getService()
      const path = await folderPath(parentId)
      if (path === undefined) throw new Error('No directory with that id')

      if (kind === 'dir') {
        const dir = await service.directories.create(name, path ?? undefined)
        return directoryToItem(dir, parentId)
      }

      if (!srcPath) throw new Error('Creating a file needs the path holding its bytes')
      const source = requireHandoffPath(srcPath)
      if (!fsIO.adoptFile) throw new Error('This host cannot take ownership of a file by path')

      const id = uniqueId()
      // The name the user chose is the better signal: the staged file is a
      // UUID with no extension, so sniffing it alone types every text file as
      // a byte stream.
      const type =
        getMimeTypeFromExtension(name) ??
        (await service.fs.detectMimeType(source)) ??
        'application/octet-stream'
      const adopted = await fsIO.adoptFile({ id, type }, source)
      const now = Date.now()
      // Created already filed: an insert at root followed by a move would
      // journal a departure from root that no reader ever saw.
      const dir = path === null ? null : await service.directories.getByPath(path)
      await service.files.create(
        {
          id,
          name,
          type,
          kind: 'file',
          size: adopted.size,
          hash: adopted.hash,
          trashedAt: null,
          createdAt: now,
          updatedAt: now,
          mediaAssetId: null,
          addedAt: now,
          deletedAt: null,
        },
        undefined,
        { directoryId: dir?.id ?? null },
      )
      await service.fs.upsertMeta({ fileId: id, size: adopted.size, addedAt: now, usedAt: now })
      // The uploader owns getting it to the indexer; this call only stages it.
      await service.uploader.enqueueByIds([id])

      const created = await item(id)
      if (!created) throw new Error(`Created file ${id} could not be read back`)
      return created
    },

    async write(id, srcPath) {
      const service = getService()
      const source = requireHandoffPath(srcPath)
      if (!fsIO.adoptFile) throw new Error('This host cannot take ownership of a file by path')

      const file = await service.files.getById(id)
      if (!file) throw new Error(`No file with id ${id}`)
      const adopted = await fsIO.adoptFile({ id: file.id, type: file.type }, source)
      // The clock moves with the content, and past the row's own stamp: sync
      // orders metadata by updatedAt, sync-down stores the other device's wall
      // clock verbatim, so a frozen or plain-now stamp can tie with or trail the
      // state this write replaces and lose the sync race. 'bump' stamps
      // max(now, updatedAt + 1) in SQL, so a sync-down landing a future clock
      // during the slow adoptFile above cannot beat it.
      await service.files.update(
        { id: file.id, size: adopted.size, hash: adopted.hash },
        { updatedAt: 'bump' },
      )
      await service.fs.upsertMeta({
        fileId: file.id,
        size: adopted.size,
        addedAt: Date.now(),
        usedAt: Date.now(),
      })
      await service.uploader.enqueueByIds([file.id])

      const updated = await item(id)
      if (!updated) throw new Error(`No file with id ${id}`)
      return updated
    },

    async rename(id, newParentId, newName) {
      const service = getService()
      const directoryId = parseDirectoryProviderId(id)

      if (directoryId !== null) {
        const dir = await service.directories.getById(directoryId)
        if (!dir) throw new Error('No directory with that id')
        if (dir.name !== newName) await service.directories.rename(directoryId, newName)
        const destination = await folderPath(newParentId)
        if (destination === undefined) throw new Error('No directory with that id')
        const current = await service.directories.getById(directoryId)
        if (current && ops.directoryParentPath(current.path) !== destination) {
          await service.directories.moveDirectory(directoryId, destination)
        }
        const moved = await item(id)
        if (!moved) throw new Error('No directory with that id')
        return moved
      }

      const file = await service.files.getById(id)
      if (!file) throw new Error(`No file with id ${id}`)
      if (file.name !== newName) await service.files.renameFile(id, newName)

      const destination = await folderPath(newParentId)
      if (destination === undefined) throw new Error('No directory with that id')
      // Moves the whole version stack. Moving the single current row would
      // split a file's history across two folders.
      const dir = destination === null ? null : await service.directories.getByPath(destination)
      await service.files.moveFile(id, dir ? dir.id : null)

      const updated = await item(id)
      if (!updated) throw new Error(`No file with id ${id}`)
      return updated
    },

    async trash(id) {
      const service = getService()
      const directoryId = parseDirectoryProviderId(id)
      if (directoryId !== null) {
        // Cascades to the files inside, all reversibly.
        await service.directories.deleteAndTrashFiles(directoryId)
        return
      }
      // Always reversible. The OS owns permanent delete, and a shell mistake
      // must never be unrecoverable.
      await service.files.trashFile(id)
    },
  }
}

/**
 * Collapses `.`, `..`, and repeated separators without touching the disk.
 *
 * Text only, because a fetch names a destination that does not exist yet and
 * there is nothing on disk to resolve. Nothing here follows a link.
 */
function normalizePath(input: string): string {
  const isAbsolute = input.startsWith('/')
  const parts: string[] = []
  for (const segment of input.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (!isAbsolute) parts.push('..')
      continue
    }
    parts.push(segment)
  }
  const joined = parts.join('/')
  return isAbsolute ? `/${joined}` : joined
}
