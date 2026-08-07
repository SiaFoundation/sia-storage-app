/*
 * The surface an OS storage-provider shell drives: describe one file or
 * folder, list a folder a page at a time, and say what changed since an
 * anchor.
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
import type { FileRecordRow } from '../../types/files'
import {
  directoryProviderId,
  parseDirectoryProviderId,
  WORKING_SET_ID,
  type ProviderItem,
} from '../../types/provider'
import type { AppService } from '../service'
import { folderFingerprint, formatAnchor, parseAnchor } from '../providerAnchor'

/** Rows per page. */
const MAX_PAGE_SIZE = 500

export type ProviderNamespaceDeps = {
  getService: () => AppService
  db: DatabaseAdapter
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
  const { getService, db } = deps
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
      metadataVersion: [row.updatedAt, row.name, row.size, parentId ?? ''].join(':'),
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
      size: 0,
      createdAt: dir.createdAt,
      modifiedAt: dir.createdAt,
      contentVersion: dir.id,
      metadataVersion: `${dir.path}:${dir.createdAt}`,
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

  async function listFiles(
    path: string | null,
    limit: number,
    offset: number,
  ): Promise<Array<FileRecordRow & { fsExists: number }>> {
    const service = getService()
    // A directory row is addressed by path in the library but by id at the OS
    // boundary; the root has no row at all, so it filters on the unfiled
    // sentinel rather than a real id.
    let directoryId: string
    if (path === null) {
      directoryId = UNFILED_DIRECTORY_ID
    } else {
      const dir = await service.directories.getByPath(path)
      if (!dir) return []
      directoryId = dir.id
    }
    return service.files.queryLibrary({ directoryId, limit, offset })
  }

  function subdirectories(path: string | null): Promise<Directory[]> {
    return ops.queryDirectorySubdirectories(db, path)
  }

  /** Reads one item. Hoisted because other verbs read back through it. */
  async function item(id: string): Promise<ProviderItem | null> {
    const service = getService()
    const directoryId = parseDirectoryProviderId(id)
    if (directoryId !== null) {
      const dir = await service.directories.getById(directoryId)
      if (!dir) return null
      const parentPath = directoryParent(dir.path)
      const parent = parentPath === null ? null : await service.directories.getByPath(parentPath)
      return directoryToItem(dir, parent ? directoryProviderId(parent.id) : null)
    }

    const row = await ops.queryProviderItem(db, id)
    if (!row) return null
    const [found] = await itemsForFiles([row], parentOf)
    return found ?? null
  }

  return {
    item,

    async list(folderId, cursor) {
      // The working set has no listing; it exists for the change feed.
      if (folderId === WORKING_SET_ID) return { items: [] }

      const path = await folderPath(folderId)
      // A folder that vanished between the OS listing it and asking for its
      // contents reads as empty. Reporting an error instead makes a file
      // browser show a failure for a folder the user already deleted.
      if (path === undefined) return { items: [] }

      const offset = cursor ? Number.parseInt(cursor, 10) : 0
      if (!Number.isInteger(offset) || offset < 0) return { items: [] }

      const items: ProviderItem[] = []
      // Subfolders are only reported on the first page: they are read whole,
      // so paging them alongside files would repeat them on every page.
      if (offset === 0) {
        for (const dir of await subdirectories(path)) {
          items.push(directoryToItem(dir, folderId))
        }
      }

      const rows = await listFiles(path, pageSize, offset)
      items.push(...(await itemsForFiles(rows, () => folderId)))

      const nextCursor = rows.length === pageSize ? String(offset + rows.length) : undefined
      return nextCursor === undefined ? { items } : { items, cursor: nextCursor }
    },

    async changes(folderId, anchor) {
      const since = parseAnchor(anchor)
      const empty = { items: [], deletedIds: [], anchor, hasMore: false, expired: false }

      // Every folder at once. A file leaving one changes neither that folder's
      // contents nor the new one's in a way a per-folder read can express, so
      // this is where a move becomes visible. It lists no folders of its own,
      // so it has no folder set to compare.
      if (folderId === WORKING_SET_ID) {
        const page = await ops.queryProviderChanges(db, null, since, pageSize)
        return {
          items: await itemsForFiles(page.changed, parentOf),
          deletedIds: page.removed,
          anchor: formatAnchor(page.cursor, ''),
          hasMore: page.hasMore,
          expired: false,
        }
      }

      const path = await folderPath(folderId)
      if (path === undefined) return empty

      const directoryId = path === null ? UNFILED_DIRECTORY_ID : ((await dirIdFor(path)) ?? null)
      if (directoryId === null) return empty

      const children = await subdirectories(path)
      const folders = folderFingerprint(children.map((dir) => dir.id))

      // A deleted folder leaves no row to name, so it can only be reported by
      // expiring the anchor and letting the caller list, which says what exists
      // rather than what changed. Any difference expires: a fingerprint cannot
      // tell an addition from an addition beside a removal, and a missed
      // removal is a folder that never goes away.
      if (since.folders !== '' && since.folders !== folders) {
        return {
          items: [],
          deletedIds: [],
          anchor: formatAnchor(since, folders),
          hasMore: false,
          expired: true,
        }
      }

      const page = await ops.queryProviderChanges(db, directoryId, since, pageSize)
      const items = await itemsForFiles(page.changed, parentOf)

      // Every subfolder, every time. A folder carries no edit clock, so there
      // is nothing to compare an anchor against; the OS drops the ones whose
      // metadata version it already holds.
      for (const dir of children) {
        items.push(directoryToItem(dir, folderId))
      }

      return {
        items,
        deletedIds: page.removed,
        anchor: formatAnchor(page.cursor, folders),
        hasMore: page.hasMore,
        expired: false,
      }
    },
  }
}

/** The parent of a directory path, or null when it sits at the root. */
function directoryParent(path: string): string | null {
  const i = path.lastIndexOf('/')
  return i === -1 ? null : path.slice(0, i)
}
