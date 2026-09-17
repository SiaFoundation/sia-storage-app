import type { DatabaseAdapter } from '../../adapters/db'
import { naturalSortKey } from '../../lib/naturalSortKey'
import { uniqueId } from '../../lib/uniqueId'
import type { FileRecord, FileRecordRow } from '../../types/files'
import * as sql from '../sql'
import { FILE_ROW_COLUMNS_F, recalculateCurrentForGroup, transformRow } from './files'
import { buildRecordFilter } from './library'
import { flagObjectsForFiles, queryObjectRefsForFile } from './localObjects'
import { trashFilesAndThumbnails } from './trash'

export type Directory = {
  id: string
  path: string
  name: string
  createdAt: number
  /** The parent directory's row id; null at the root. */
  parentId: string | null
}

export type DirectoryWithCount = Directory & {
  fileCount: number
  subdirectoryCount: number
}

export function directoryDisplayName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

export function directoryParentPath(path: string): string | null {
  const i = path.lastIndexOf('/')
  return i === -1 ? null : path.slice(0, i)
}

export function directoryBreadcrumbs(path: string): { segment: string; path: string }[] {
  const segments = path.split('/')
  const result: { segment: string; path: string }[] = []
  for (let i = 0; i < segments.length; i++) {
    result.push({
      segment: segments[i],
      path: segments.slice(0, i + 1).join('/'),
    })
  }
  return result
}

export function escapeLikePattern(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&')
}

function sqlEscapeLike(col: string): string {
  return `replace(replace(${col}, '%', '\\%'), '_', '\\_')`
}

export function sanitizeDirectorySegment(segment: string): string {
  let result = ''
  for (const ch of segment) {
    const code = ch.codePointAt(0)!
    if (ch === '/' || ch === '\\') continue
    if (code < 0x20 || code === 0x7f) continue
    result += ch
  }
  result = result.trim()
  if (/^\.+$/.test(result)) return ''
  return result.slice(0, 255)
}

export function sanitizeDirectoryPath(path: string): string {
  return path.split('/').map(sanitizeDirectorySegment).filter(Boolean).join('/')
}

function toDirectory(row: DirectoryRow): Directory {
  return {
    id: row.id,
    path: row.path,
    name: directoryDisplayName(row.path),
    createdAt: row.createdAt,
    parentId: row.parentId,
  }
}

type DirectoryRow = { id: string; path: string; createdAt: number; parentId: string | null }

/**
 * The id for a parent path, creating the chain when no row exists. Insert-time
 * resolution is safe where trigger-time was not: the parent row exists and its
 * path is current when a child is created.
 */
async function parentIdForPath(db: DatabaseAdapter, parentPath?: string): Promise<string | null> {
  if (!parentPath) return null
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM directories WHERE path = ?',
    parentPath,
  )
  if (row) return row.id
  return (await getOrCreateDirectoryAtPath(db, parentPath)).id
}

export async function insertDirectory(
  db: DatabaseAdapter,
  name: string,
  parentPath?: string,
): Promise<Directory> {
  const trimmed = sanitizeDirectorySegment(name)
  if (!trimmed) {
    throw new Error('Folder name cannot be empty')
  }

  // Sanitized before both uses: the child's path and its parentId must
  // derive from the same string, or a raw 'Docs/' would store 'Docs//child'
  // under the id of 'Docs'.
  parentPath = parentPath ? sanitizeDirectoryPath(parentPath) || undefined : undefined
  const fullPath = parentPath ? `${parentPath}/${trimmed}` : trimmed

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM directories WHERE path = ?',
    fullPath,
  )
  if (existing) {
    throw new Error(`Folder "${trimmed}" already exists`)
  }

  const now = Date.now()
  const row: DirectoryRow = {
    id: uniqueId(),
    path: fullPath,
    createdAt: now,
    parentId: await parentIdForPath(db, parentPath),
  }

  await sql.insert(db, 'directories', {
    ...row,
    nameSortKey: naturalSortKey(fullPath),
  })
  return toDirectory(row)
}

export async function getOrCreateDirectory(
  db: DatabaseAdapter,
  name: string,
  parentPath?: string,
): Promise<Directory> {
  const trimmed = sanitizeDirectorySegment(name)
  if (!trimmed) {
    throw new Error('Folder name cannot be empty')
  }

  // Sanitized for the same reason as insertDirectory.
  parentPath = parentPath ? sanitizeDirectoryPath(parentPath) || undefined : undefined
  const fullPath = parentPath ? `${parentPath}/${trimmed}` : trimmed

  const now = Date.now()
  const id = uniqueId()
  const parentId = await parentIdForPath(db, parentPath)
  await db.runAsync(
    `INSERT OR IGNORE INTO directories (id, path, createdAt, nameSortKey, parentId) VALUES (?, ?, ?, ?, ?)`,
    id,
    fullPath,
    now,
    naturalSortKey(fullPath),
    parentId,
  )

  const row = await db.getFirstAsync<DirectoryRow>(
    'SELECT id, path, createdAt, parentId FROM directories WHERE path = ?',
    fullPath,
  )

  if (!row) {
    throw new Error(`Failed to get or create directory "${trimmed}"`)
  }

  return toDirectory(row)
}

export async function getOrCreateDirectoryAtPath(
  db: DatabaseAdapter,
  dirPath: string,
): Promise<Directory> {
  const segments = dirPath.split('/')
  let currentPath = ''

  // Root to leaf, so ancestors feed-stamp before descendants: the OS shell
  // drops an item that pages in ahead of a parent it has not met.
  let dir: Directory | undefined
  for (const segment of segments) {
    const trimmed = sanitizeDirectorySegment(segment)
    if (!trimmed) continue

    const parentPath = currentPath || undefined
    dir = await getOrCreateDirectory(db, trimmed, parentPath)
    currentPath = dir.path
  }

  if (!dir) {
    throw new Error(`Invalid directory path: "${dirPath}"`)
  }

  return dir
}

export async function queryDirectoryById(
  db: DatabaseAdapter,
  id: string,
): Promise<Directory | null> {
  const row = await db.getFirstAsync<DirectoryRow>(
    'SELECT id, path, createdAt, parentId FROM directories WHERE id = ?',
    id,
  )
  return row ? toDirectory(row) : null
}

export async function queryDirectoryByPath(
  db: DatabaseAdapter,
  path: string,
): Promise<Directory | null> {
  const row = await db.getFirstAsync<DirectoryRow>(
    'SELECT id, path, createdAt, parentId FROM directories WHERE path = ? LIMIT 1',
    path,
  )
  return row ? toDirectory(row) : null
}

/**
 * Every directory with its recursive file count and direct-subdirectory count, from one
 * GROUP BY over active files rolled up each path's ancestor chain in memory. The natural
 * SQL, a correlated subtree subquery per listed row, re-tests every directory row for every
 * row it lists, so its cost climbs with the directory count where this is one scan of the
 * file index plus one walk of the directory list; at a few thousand directories that is
 * seconds against milliseconds. It also depends on the planner having fresh statistics,
 * which PRAGMA optimize refreshes only lazily. The GROUP BY matches
 * idx_files_current_directoryId's partial predicate, so passing filter options to
 * buildRecordFilter would give up that index.
 *
 * `scope` is 'all', or the immediate children of `parentPath` (root level when it is null).
 * Matching is exact rather than SQL LIKE, which is ASCII-case-insensitive and would list a
 * sibling `photos/`'s children under `Photos`.
 */
async function queryDirectoriesWithCounts(
  db: DatabaseAdapter,
  scope: 'all' | { parentPath: string | null },
): Promise<DirectoryWithCount[]> {
  const dirs = await db.getAllAsync<DirectoryRow>(
    'SELECT id, path, createdAt, parentId FROM directories ORDER BY nameSortKey',
  )
  const directRows = await db.getAllAsync<{ directoryId: string; fileCount: number }>(
    `SELECT f.directoryId, COUNT(*) AS fileCount FROM files f
      WHERE f.directoryId IS NOT NULL AND ${buildRecordFilter('f')}
      GROUP BY f.directoryId`,
  )
  const directCounts = new Map(directRows.map((r) => [r.directoryId, r.fileCount]))

  const fileCounts = new Map<string, number>()
  const subdirectoryCounts = new Map<string, number>()
  for (const d of dirs) {
    const direct = directCounts.get(d.id) ?? 0
    if (direct > 0) {
      // A directory's own files count toward its total and every ancestor's.
      fileCounts.set(d.path, (fileCounts.get(d.path) ?? 0) + direct)
      for (let i = d.path.indexOf('/'); i !== -1; i = d.path.indexOf('/', i + 1)) {
        const ancestor = d.path.slice(0, i)
        fileCounts.set(ancestor, (fileCounts.get(ancestor) ?? 0) + direct)
      }
    }
    const parent = directoryParentPath(d.path)
    if (parent !== null) {
      subdirectoryCounts.set(parent, (subdirectoryCounts.get(parent) ?? 0) + 1)
    }
  }

  const inScope = (path: string): boolean =>
    scope === 'all' || directoryParentPath(path) === scope.parentPath

  return dirs
    .filter((d) => inScope(d.path))
    .map((d) => ({
      ...toDirectory(d),
      fileCount: fileCounts.get(d.path) ?? 0,
      subdirectoryCount: subdirectoryCounts.get(d.path) ?? 0,
    }))
}

export async function queryDirectoryChildren(
  db: DatabaseAdapter,
  parentPath: string | null,
): Promise<DirectoryWithCount[]> {
  return queryDirectoriesWithCounts(db, { parentPath })
}

/**
 * One keyset page of a directory's children in name order, without the
 * per-row descendant counts: the provider reads children on every listing
 * and draws nothing from counts, and the counted variant scans every active
 * file to build them.
 */
export async function queryDirectoriesByParent(
  db: DatabaseAdapter,
  parentId: string | null,
  after: { nameSortKey: string; id: string } | null,
  limit: number,
): Promise<(Directory & { nameSortKey: string })[]> {
  const cond = parentId === null ? 'parentId IS NULL' : 'parentId = ?'
  const params = parentId === null ? [] : [parentId]
  const cursorCond = after === null ? '' : 'AND (nameSortKey > ? OR (nameSortKey = ? AND id > ?))'
  const cursorParams = after === null ? [] : [after.nameSortKey, after.nameSortKey, after.id]
  const rows = await db.getAllAsync<DirectoryRow & { nameSortKey: string }>(
    `SELECT id, path, createdAt, parentId, nameSortKey FROM directories
     WHERE ${cond} ${cursorCond}
     ORDER BY nameSortKey ASC, id ASC
     LIMIT ?`,
    ...params,
    ...cursorParams,
    limit,
  )
  return rows.map((row) => ({ ...toDirectory(row), nameSortKey: row.nameSortKey }))
}

export async function queryCountDirectories(db: DatabaseAdapter): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM directories')
  return row?.n ?? 0
}

/** Directory rows for a set of ids; departed folders resolve their current state through this. */
export async function queryDirectoriesByIds(
  db: DatabaseAdapter,
  ids: string[],
): Promise<Directory[]> {
  if (ids.length === 0) return []
  const ph = ids.map(() => '?').join(',')
  const rows = await db.getAllAsync<DirectoryRow>(
    `SELECT id, path, createdAt, parentId FROM directories WHERE id IN (${ph})`,
    ...ids,
  )
  return rows.map(toDirectory)
}

/**
 * One keyset page of directories in path order. A strict prefix sorts before
 * all its extensions, so a parent always precedes its own descendants,
 * which is the delivery order the OS shell needs.
 */
export async function queryDirectoriesAfterPath(
  db: DatabaseAdapter,
  afterPath: string,
  limit: number,
): Promise<Directory[]> {
  const rows = await db.getAllAsync<DirectoryRow>(
    `SELECT d.id, d.path, d.createdAt, d.parentId FROM directories d
     WHERE d.path > ? ORDER BY d.path LIMIT ?`,
    afterPath,
    limit,
  )
  return rows.map(toDirectory)
}

export async function queryAllDirectoriesWithCounts(
  db: DatabaseAdapter,
): Promise<DirectoryWithCount[]> {
  return queryDirectoriesWithCounts(db, 'all')
}

export async function queryDirectoryPathForFile(
  db: DatabaseAdapter,
  fileId: string,
): Promise<string | undefined> {
  const row = await db.getFirstAsync<{ path: string }>(
    `SELECT d.path FROM directories d
     INNER JOIN files f ON f.directoryId = d.id
     WHERE f.id = ?`,
    fileId,
  )
  return row?.path
}

export async function syncDirectoryFromMetadata(
  db: DatabaseAdapter,
  fileId: string,
  directoryPath: string | undefined,
  options?: { skipCurrentRecalc?: boolean },
): Promise<void> {
  if (directoryPath === undefined) return
  const dir = await getOrCreateDirectoryAtPath(db, directoryPath)
  if (options?.skipCurrentRecalc) {
    await sql.update(db, 'files', { directoryId: dir.id }, { id: fileId })
    return
  }
  const row = await db.getFirstAsync<{
    name: string
    directoryId: string | null
  }>('SELECT name, directoryId FROM files WHERE id = ?', fileId)
  await sql.update(db, 'files', { directoryId: dir.id }, { id: fileId })
  if (row) {
    await recalculateCurrentForGroup(db, row.name, row.directoryId)
    await recalculateCurrentForGroup(db, row.name, dir.id)
  }
}

export async function ensureDirectoriesAtPaths(
  db: DatabaseAdapter,
  fullPaths: Iterable<string>,
): Promise<Map<string, string>> {
  // Expand each input path into its sanitized normal form and all of
  // its prefixes so a/b/c also creates a and a/b. Map the original
  // input string to the normalized path so callers can look up by what
  // they passed in.
  const inputToNormalized = new Map<string, string>()
  const prefixes = new Set<string>()
  for (const raw of fullPaths) {
    const segments = raw.split('/').map(sanitizeDirectorySegment).filter(Boolean)
    if (segments.length === 0) {
      inputToNormalized.set(raw, '')
      continue
    }
    let cur = ''
    for (const seg of segments) {
      cur = cur ? `${cur}/${seg}` : seg
      prefixes.add(cur)
    }
    inputToNormalized.set(raw, cur)
  }
  if (prefixes.size === 0) return new Map()

  const arr = [...prefixes]
  const ph = arr.map(() => '?').join(',')
  const existing = await db.getAllAsync<{ id: string; path: string }>(
    `SELECT id, path FROM directories WHERE path IN (${ph})`,
    ...arr,
  )
  const pathToId = new Map(existing.map((r) => [r.path, r.id]))
  // Path order is prefix order, so parents insert, and feed-stamp, before
  // their children.
  const missing = arr.filter((p) => !pathToId.has(p)).sort()
  if (missing.length > 0) {
    const now = Date.now()
    const newIds = new Map(missing.map((path) => [path, uniqueId()]))
    const rows = missing.map((path) => {
      const parent = directoryParentPath(path)
      return {
        id: newIds.get(path)!,
        path,
        createdAt: now,
        nameSortKey: naturalSortKey(path),
        parentId: parent === null ? null : (pathToId.get(parent) ?? newIds.get(parent) ?? null),
      }
    })
    await sql.insertMany(db, 'directories', rows, { conflictClause: 'OR IGNORE' })
    // OR IGNORE may have rejected rows that another writer inserted
    // first, re-SELECT to pick up the actual id for every missing path.
    const phM = missing.map(() => '?').join(',')
    const inserted = await db.getAllAsync<{ id: string; path: string }>(
      `SELECT id, path FROM directories WHERE path IN (${phM})`,
      ...missing,
    )
    for (const r of inserted) pathToId.set(r.path, r.id)
    // A row inserted here whose parent lost the OR IGNORE race points at an
    // id that was never inserted; repoint it at the row that exists. The
    // rewrite journals a departure from the phantom id, which no scope ever
    // queries by.
    for (const row of rows) {
      const parent = directoryParentPath(row.path)
      if (parent === null) continue
      const actualParent = pathToId.get(parent)
      if (
        pathToId.get(row.path) === row.id &&
        actualParent !== undefined &&
        actualParent !== row.parentId
      ) {
        await db.runAsync(`UPDATE directories SET parentId = ? WHERE id = ?`, actualParent, row.id)
      }
    }
  }

  const result = new Map<string, string>()
  for (const [input, normalized] of inputToNormalized) {
    if (!normalized) continue
    const id = pathToId.get(normalized)
    if (id) result.set(input, id)
  }
  return result
}

export async function syncManyDirectoriesFromMetadata(
  db: DatabaseAdapter,
  entries: { fileId: string; directoryPath: string }[],
): Promise<{ name: string; directoryId: string | null }[]> {
  if (entries.length === 0) return []

  const dirPaths = new Set(entries.map((e) => e.directoryPath))
  const pathToId = await ensureDirectoriesAtPaths(db, dirPaths)

  const fileIds = entries.map((e) => e.fileId)
  const ph = fileIds.map(() => '?').join(',')
  const oldGroups = await db.getAllAsync<{ name: string; directoryId: string | null }>(
    `SELECT DISTINCT f.name, f.directoryId FROM files f WHERE f.id IN (${ph}) AND f.kind = 'file'`,
    ...fileIds,
  )

  const byDirId = new Map<string, string[]>()
  for (const entry of entries) {
    const dirId = pathToId.get(entry.directoryPath)
    if (!dirId) continue
    const list = byDirId.get(dirId) ?? []
    list.push(entry.fileId)
    byDirId.set(dirId, list)
  }
  for (const [dirId, ids] of byDirId) {
    const idsPh = ids.map(() => '?').join(',')
    await db.runAsync(`UPDATE files SET directoryId = ? WHERE id IN (${idsPh})`, dirId, ...ids)
  }

  return oldGroups
}

export async function moveFileToDirectory(
  db: DatabaseAdapter,
  fileId: string,
  dirId: string | null,
): Promise<void> {
  const row = await db.getFirstAsync<{
    name: string
    directoryId: string | null
  }>('SELECT name, directoryId FROM files WHERE id = ?', fileId)
  await db.withTransactionAsync(async () => {
    await sql.update(db, 'files', { directoryId: dirId, updatedAt: Date.now() }, { id: fileId })
    await flagObjectsForFiles(db, [fileId])
  })
  if (row) {
    await recalculateCurrentForGroup(db, row.name, row.directoryId)
    await recalculateCurrentForGroup(db, row.name, dirId)
  }
}

export async function deleteDirectory(db: DatabaseAdapter, id: string): Promise<void> {
  const dir = await queryDirectoryById(db, id)
  if (!dir) return

  const escaped = escapeLikePattern(dir.path)

  const subtreeDirIds = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM directories WHERE path = ? OR path LIKE ? || '/%' ESCAPE '\\'`,
    dir.path,
    escaped,
  )
  const dirIds = subtreeDirIds.map((d) => d.id)

  const dirPh = dirIds.map(() => '?').join(',')
  const groups = await db.getAllAsync<{ name: string }>(
    `SELECT DISTINCT name FROM files WHERE directoryId IN (${dirPh}) AND kind = 'file'`,
    ...dirIds,
  )

  const now = Date.now()
  // Capture ids before the UPDATE nulls directoryId, the object flag can't
  // re-derive them afterward.
  const affected = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM files WHERE directoryId IN (${dirPh})`,
    ...dirIds,
  )
  const affectedIds = affected.map((f) => f.id)
  await db.withTransactionAsync(async () => {
    // max() per row: a plain stamp would move a future-clocked row (a remote
    // wall clock via sync-down) backwards and lose its reparent to sync.
    await db.runAsync(
      `UPDATE files SET directoryId = NULL, updatedAt = max(?, updatedAt + 1) WHERE directoryId IN (${dirPh})`,
      now,
      ...dirIds,
    )
    await flagObjectsForFiles(db, affectedIds)
    await db.runAsync(
      `DELETE FROM directories WHERE path = ? OR path LIKE ? || '/%' ESCAPE '\\'`,
      dir.path,
      escaped,
    )
  })

  for (const g of groups) {
    await recalculateCurrentForGroup(db, g.name, null)
  }
}

export async function deleteDirectoryAndTrashFiles(
  db: DatabaseAdapter,
  id: string,
): Promise<number> {
  const dir = await queryDirectoryById(db, id)
  if (!dir) return 0

  const escaped = escapeLikePattern(dir.path)

  const totalTrashed = await sql.processInBatches<{ id: string }>(
    db,
    `SELECT f.id FROM files f
     INNER JOIN directories d ON f.directoryId = d.id
     WHERE (d.path = ? OR d.path LIKE ? || '/%' ESCAPE '\\')
       AND f.kind = 'file' AND ${buildRecordFilter('f', { includeOldVersions: true })}`,
    [dir.path, escaped],
    500,
    async (rows) => {
      await trashFilesAndThumbnails(
        db,
        rows.map((r) => r.id),
      )
    },
  )

  await db.runAsync(
    `DELETE FROM directories WHERE path = ? OR path LIKE ? || '/%' ESCAPE '\\'`,
    dir.path,
    escaped,
  )

  return totalTrashed
}

/**
 * Deletes directories that have no active files and no subdirectories.
 * Walks up the tree one level per iteration: if removing a directory makes
 * its parent empty, the parent is evaluated on the next pass.
 *
 * Iteration count is bounded by tree depth (3 queries per level). Per
 * iteration the queries scale linearly with the candidate set, which
 * starts at `directoryIds.length` and shrinks toward the tree's width
 * (one row per unique parent path) after the first pass.
 */
export async function deleteEmptyDirectories(
  db: DatabaseAdapter,
  directoryIds: string[],
): Promise<number> {
  if (directoryIds.length === 0) return 0
  let candidates = [...new Set(directoryIds)]
  let totalDeleted = 0

  while (candidates.length > 0) {
    const ph = candidates.map(() => '?').join(',')
    const empties = await db.getAllAsync<{ id: string; path: string }>(
      `SELECT d.id, d.path FROM directories d
       WHERE d.id IN (${ph})
         AND NOT EXISTS (
           SELECT 1 FROM files f
           WHERE f.directoryId = d.id AND ${buildRecordFilter('f')}
         )
         AND NOT EXISTS (
           SELECT 1 FROM directories c
           WHERE c.path LIKE ${sqlEscapeLike('d.path')} || '/%' ESCAPE '\\'
             AND c.path NOT LIKE ${sqlEscapeLike('d.path')} || '/%/%' ESCAPE '\\'
         )`,
      ...candidates,
    )

    if (empties.length === 0) break

    const idPh = empties.map(() => '?').join(',')
    await db.runAsync(`DELETE FROM directories WHERE id IN (${idPh})`, ...empties.map((e) => e.id))
    totalDeleted += empties.length

    const parentPaths = [
      ...new Set(
        empties.map((e) => directoryParentPath(e.path)).filter((p): p is string => p !== null),
      ),
    ]
    if (parentPaths.length === 0) break

    const pathPh = parentPaths.map(() => '?').join(',')
    const parents = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM directories WHERE path IN (${pathPh})`,
      ...parentPaths,
    )
    candidates = parents.map((p) => p.id)
  }

  return totalDeleted
}

export async function queryCountFilesWithDirectories(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<number> {
  if (fileIds.length === 0) return 0
  const ph = fileIds.map(() => '?').join(',')
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f WHERE f.id IN (${ph}) AND f.directoryId IS NOT NULL AND ${buildRecordFilter('f')}`,
    ...fileIds,
  )
  return row?.count ?? 0
}

export async function queryFileByNameInDirectory(
  db: DatabaseAdapter,
  fileName: string,
  directoryPath: string,
): Promise<FileRecordRow | null> {
  if (!fileName) return null
  return db.getFirstAsync<FileRecordRow>(
    `SELECT ${FILE_ROW_COLUMNS_F}
     FROM files f
     INNER JOIN directories d ON f.directoryId = d.id
     WHERE f.name = ? AND ${buildRecordFilter('f')}
       AND d.path = ?
     ORDER BY f.updatedAt DESC, f.id DESC
     LIMIT 1`,
    fileName,
    directoryPath,
  )
}

export async function readFileByNameInDirectoryPath(
  db: DatabaseAdapter,
  fileName: string,
  directoryPath: string,
): Promise<FileRecord | null> {
  const row = await queryFileByNameInDirectory(db, fileName, directoryPath)
  if (!row) return null
  const objects = await queryObjectRefsForFile(db, row.id)
  return transformRow(row, objects)
}

export async function queryFilesByDirectoryPath(
  db: DatabaseAdapter,
  directoryPath: string,
): Promise<FileRecordRow[]> {
  return db.getAllAsync<FileRecordRow>(
    `SELECT ${FILE_ROW_COLUMNS_F}
     FROM files f
     INNER JOIN directories d ON f.directoryId = d.id
     WHERE d.path = ? AND ${buildRecordFilter('f')}
     ORDER BY f.nameSortKey`,
    directoryPath,
  )
}

export async function renameDirectory(
  db: DatabaseAdapter,
  dirId: string,
  name: string,
): Promise<Directory> {
  const trimmed = sanitizeDirectorySegment(name)
  if (!trimmed) {
    throw new Error('Folder name cannot be empty')
  }

  const dir = await queryDirectoryById(db, dirId)
  if (!dir) {
    throw new Error('Directory not found')
  }

  const slashIdx = dir.path.lastIndexOf('/')
  const parentPath = slashIdx === -1 ? '' : dir.path.slice(0, slashIdx)
  const newPath = parentPath ? `${parentPath}/${trimmed}` : trimmed

  if (newPath !== dir.path) {
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM directories WHERE path = ? AND id != ?',
      newPath,
      dirId,
    )
    if (existing) {
      throw new Error(`Folder "${trimmed}" already exists`)
    }
  }

  await rebaseDirectoryTree(db, dirId, dir.path, newPath, dir.parentId)

  return toDirectory({ id: dirId, path: newPath, createdAt: dir.createdAt, parentId: dir.parentId })
}

export async function moveDirectory(
  db: DatabaseAdapter,
  dirId: string,
  newParentPath: string | null,
): Promise<void> {
  const dir = await queryDirectoryById(db, dirId)
  if (!dir) {
    throw new Error('Directory not found')
  }

  const leafName = directoryDisplayName(dir.path)
  const targetParent = newParentPath === null ? '' : sanitizeDirectoryPath(newParentPath)

  if (targetParent === dir.path || targetParent.startsWith(`${dir.path}/`)) {
    throw new Error('Cannot move a folder into itself or a subfolder of itself')
  }

  // The destination chain is created rather than trusted to exist: a parent
  // path with no row would otherwise mint an orphan whose parentId has
  // nothing to point at.
  const parent = targetParent === '' ? null : await getOrCreateDirectoryAtPath(db, targetParent)
  const newPath = parent ? `${parent.path}/${leafName}` : leafName

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM directories WHERE path = ? AND id != ?',
    newPath,
    dirId,
  )
  if (existing) {
    throw new Error(`Folder "${leafName}" already exists at destination`)
  }

  await rebaseDirectoryTree(db, dirId, dir.path, newPath, parent ? parent.id : null)
}

async function rebaseDirectoryTree(
  db: DatabaseAdapter,
  dirId: string,
  oldPath: string,
  newPath: string,
  newParentId: string | null,
): Promise<void> {
  const escaped = escapeLikePattern(oldPath)

  const descendants = await db.getAllAsync<{ id: string; path: string }>(
    `SELECT id, path FROM directories WHERE path LIKE ? || '/%' ESCAPE '\\'`,
    escaped,
  )

  const updates = descendants.map((desc) => {
    const descNewPath = newPath + desc.path.slice(oldPath.length)
    return {
      id: desc.id,
      path: descNewPath,
      nameSortKey: naturalSortKey(descNewPath),
    }
  })

  const now = Date.now()
  const newEscaped = escapeLikePattern(newPath)

  await db.withTransactionAsync(async () => {
    // Descendants keep their parentId: only the root row re-parents, which
    // is what keeps a rename cascade free of departure journal writes.
    await db.runAsync(
      `UPDATE directories SET path = ?, nameSortKey = ?, parentId = ? WHERE id = ?`,
      newPath,
      naturalSortKey(newPath),
      newParentId,
      dirId,
    )

    for (const u of updates) {
      await db.runAsync(
        `UPDATE directories SET path = ?, nameSortKey = ? WHERE id = ?`,
        u.path,
        u.nameSortKey,
        u.id,
      )
    }

    // max() per row, same reason as deleteDirectory's child stamp.
    await db.runAsync(
      `UPDATE files SET updatedAt = max(?, updatedAt + 1) WHERE directoryId IN (
        SELECT id FROM directories WHERE path = ? OR path LIKE ? || '/%' ESCAPE '\\'
      )`,
      now,
      newPath,
      newEscaped,
    )
    await db.runAsync(
      `UPDATE objects SET needsSyncUp = 1 WHERE fileId IN (
        SELECT id FROM files WHERE directoryId IN (
          SELECT id FROM directories WHERE path = ? OR path LIKE ? || '/%' ESCAPE '\\'
        )
      )`,
      newPath,
      newEscaped,
    )
  })
}
