import type { DatabaseAdapter } from '../../adapters/db'
import { naturalSortKey } from '../../lib/naturalSortKey'
import { uniqueId } from '../../lib/uniqueId'
import type { FileRecordRow } from '../../types/files'
import * as sql from '../sql'
import { recalculateCurrentForGroup, recalculateCurrentForGroups } from './files'
import { buildLatestVersionFilter } from './library'
import { trashFiles } from './trash'

export type Directory = {
  id: string
  path: string
  name: string
  createdAt: number
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

function toDirectory(row: { id: string; path: string; createdAt: number }): Directory {
  return {
    id: row.id,
    path: row.path,
    name: directoryDisplayName(row.path),
    createdAt: row.createdAt,
  }
}

type DirectoryRow = { id: string; path: string; createdAt: number }

export async function insertDirectory(
  db: DatabaseAdapter,
  name: string,
  parentPath?: string,
): Promise<Directory> {
  const trimmed = sanitizeDirectorySegment(name)
  if (!trimmed) {
    throw new Error('Folder name cannot be empty')
  }

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

  const fullPath = parentPath ? `${parentPath}/${trimmed}` : trimmed

  const now = Date.now()
  const id = uniqueId()
  await db.runAsync(
    `INSERT OR IGNORE INTO directories (id, path, createdAt, nameSortKey) VALUES (?, ?, ?, ?)`,
    id,
    fullPath,
    now,
    naturalSortKey(fullPath),
  )

  const row = await db.getFirstAsync<DirectoryRow>(
    'SELECT id, path, createdAt FROM directories WHERE path = ?',
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
    'SELECT id, path, createdAt FROM directories WHERE id = ?',
    id,
  )
  return row ? toDirectory(row) : null
}

export async function queryDirectoryByPath(
  db: DatabaseAdapter,
  path: string,
): Promise<Directory | null> {
  const row = await db.getFirstAsync<DirectoryRow>(
    'SELECT id, path, createdAt FROM directories WHERE path = ? LIMIT 1',
    path,
  )
  return row ? toDirectory(row) : null
}

export async function queryDirectoryChildren(
  db: DatabaseAdapter,
  parentPath: string | null,
): Promise<DirectoryWithCount[]> {
  type Row = DirectoryRow & { fileCount: number; subdirectoryCount: number }

  let rows: Row[]

  if (parentPath === null) {
    rows = await db.getAllAsync<Row>(
      `SELECT d.id, d.path, d.createdAt,
        (SELECT COUNT(*) FROM files f WHERE f.directoryId = d.id AND f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL AND ${buildLatestVersionFilter('f')}) as fileCount,
        (SELECT COUNT(*) FROM directories c WHERE c.path LIKE ${sqlEscapeLike('d.path')} || '/%' ESCAPE '\\' AND c.path NOT LIKE ${sqlEscapeLike('d.path')} || '/%/%' ESCAPE '\\') as subdirectoryCount
       FROM directories d
       WHERE d.path NOT LIKE '%/%' ESCAPE '\\'
       ORDER BY d.nameSortKey`,
    )
  } else {
    const escaped = escapeLikePattern(parentPath)
    rows = await db.getAllAsync<Row>(
      `SELECT d.id, d.path, d.createdAt,
        (SELECT COUNT(*) FROM files f WHERE f.directoryId = d.id AND f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL AND ${buildLatestVersionFilter('f')}) as fileCount,
        (SELECT COUNT(*) FROM directories c WHERE c.path LIKE ${sqlEscapeLike('d.path')} || '/%' ESCAPE '\\' AND c.path NOT LIKE ${sqlEscapeLike('d.path')} || '/%/%' ESCAPE '\\') as subdirectoryCount
       FROM directories d
       WHERE d.path LIKE ? || '/%' ESCAPE '\\' AND d.path NOT LIKE ? || '/%/%' ESCAPE '\\'
       ORDER BY d.nameSortKey`,
      escaped,
      escaped,
    )
  }

  return rows.map((row) => ({
    ...toDirectory(row),
    fileCount: row.fileCount,
    subdirectoryCount: row.subdirectoryCount,
  }))
}

export async function queryAllDirectoriesWithCounts(
  db: DatabaseAdapter,
): Promise<DirectoryWithCount[]> {
  type Row = DirectoryRow & { fileCount: number; subdirectoryCount: number }

  const rows = await db.getAllAsync<Row>(
    `SELECT d.id, d.path, d.createdAt,
      (SELECT COUNT(*) FROM files f WHERE f.directoryId = d.id AND f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL AND ${buildLatestVersionFilter('f')}) as fileCount,
      (SELECT COUNT(*) FROM directories c WHERE c.path LIKE ${sqlEscapeLike('d.path')} || '/%' ESCAPE '\\' AND c.path NOT LIKE ${sqlEscapeLike('d.path')} || '/%/%' ESCAPE '\\') as subdirectoryCount
     FROM directories d
     ORDER BY d.nameSortKey`,
  )

  return rows.map((row) => ({
    ...toDirectory(row),
    fileCount: row.fileCount,
    subdirectoryCount: row.subdirectoryCount,
  }))
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

export async function syncManyDirectoriesFromMetadata(
  db: DatabaseAdapter,
  entries: { fileId: string; directoryPath: string }[],
): Promise<{ name: string; directoryId: string | null }[]> {
  if (entries.length === 0) return []

  const dirPaths = [...new Set(entries.map((e) => e.directoryPath))]
  const dirMap = new Map<string, string>()
  for (const path of dirPaths) {
    const dir = await getOrCreateDirectoryAtPath(db, path)
    dirMap.set(path, dir.id)
  }

  const fileIds = entries.map((e) => e.fileId)
  const placeholders = fileIds.map(() => '?').join(',')
  const oldGroups = await db.getAllAsync<{
    name: string
    directoryId: string | null
  }>(
    `SELECT DISTINCT f.name, f.directoryId FROM files f WHERE f.id IN (${placeholders}) AND f.kind = 'file'`,
    ...fileIds,
  )

  const byDirId = new Map<string, string[]>()
  for (const entry of entries) {
    const dirId = dirMap.get(entry.directoryPath)!
    const list = byDirId.get(dirId) || []
    list.push(entry.fileId)
    byDirId.set(dirId, list)
  }
  for (const [dirId, ids] of byDirId) {
    const ph = ids.map(() => '?').join(',')
    await db.runAsync(`UPDATE files SET directoryId = ? WHERE id IN (${ph})`, dirId, ...ids)
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
  await sql.update(db, 'files', { directoryId: dirId, updatedAt: Date.now() }, { id: fileId })
  if (row) {
    await recalculateCurrentForGroup(db, row.name, row.directoryId)
    await recalculateCurrentForGroup(db, row.name, dirId)
  }
}

export async function moveFilesToDirectory(
  db: DatabaseAdapter,
  fileIds: string[],
  dirId: string | null,
): Promise<void> {
  if (fileIds.length === 0) return
  const placeholders = fileIds.map(() => '?').join(',')
  const groups = await db.getAllAsync<{
    name: string
    directoryId: string | null
  }>(
    `SELECT DISTINCT name, directoryId FROM files WHERE id IN (${placeholders}) AND kind = 'file'`,
    ...fileIds,
  )
  const now = Date.now()
  await db.runAsync(
    `UPDATE files SET directoryId = ?, updatedAt = ? WHERE id IN (${placeholders})`,
    dirId,
    now,
    ...fileIds,
  )
  await recalculateCurrentForGroups(db, groups)
  const newGroups = new Map<string, { name: string; directoryId: string | null }>()
  for (const g of groups) {
    const key = `${g.name}|${dirId ?? ''}`
    newGroups.set(key, { name: g.name, directoryId: dirId })
  }
  for (const g of newGroups.values()) {
    await recalculateCurrentForGroup(db, g.name, g.directoryId)
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

  const ph = dirIds.map(() => '?').join(',')
  const groups = await db.getAllAsync<{ name: string }>(
    `SELECT DISTINCT name FROM files WHERE directoryId IN (${ph}) AND kind = 'file'`,
    ...dirIds,
  )

  await db.runAsync(`UPDATE files SET directoryId = NULL WHERE directoryId IN (${ph})`, ...dirIds)

  await db.runAsync(
    `DELETE FROM directories WHERE path = ? OR path LIKE ? || '/%' ESCAPE '\\'`,
    dir.path,
    escaped,
  )

  for (const g of groups) {
    await recalculateCurrentForGroup(db, g.name, null)
  }
}

export async function deleteDirectoryAndTrashFiles(
  db: DatabaseAdapter,
  id: string,
): Promise<string[]> {
  const dir = await queryDirectoryById(db, id)
  if (!dir) return []

  const escaped = escapeLikePattern(dir.path)

  const files = await db.getAllAsync<{ id: string }>(
    `SELECT f.id FROM files f
     INNER JOIN directories d ON f.directoryId = d.id
     WHERE (d.path = ? OR d.path LIKE ? || '/%' ESCAPE '\\')
       AND f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL`,
    dir.path,
    escaped,
  )

  const fileIds = files.map((f) => f.id)
  if (fileIds.length > 0) {
    await trashFiles(db, fileIds)
  }

  await db.runAsync(
    `DELETE FROM directories WHERE path = ? OR path LIKE ? || '/%' ESCAPE '\\'`,
    dir.path,
    escaped,
  )

  return fileIds
}

export async function queryCountFilesWithDirectories(
  db: DatabaseAdapter,
  fileIds: string[],
): Promise<number> {
  if (fileIds.length === 0) return 0
  const placeholders = fileIds.map(() => '?').join(',')
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files WHERE id IN (${placeholders}) AND directoryId IS NOT NULL`,
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
    `SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind,
            f.localId, f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt, f.deletedAt
     FROM files f
     INNER JOIN directories d ON f.directoryId = d.id
     WHERE f.name = ? AND f.kind = 'file'
       AND f.trashedAt IS NULL AND f.deletedAt IS NULL
       AND d.path = ?
       AND ${buildLatestVersionFilter('f')}
     ORDER BY f.updatedAt DESC, f.id DESC
     LIMIT 1`,
    fileName,
    directoryPath,
  )
}

export async function queryFilesByDirectoryPath(
  db: DatabaseAdapter,
  directoryPath: string,
): Promise<FileRecordRow[]> {
  return db.getAllAsync<FileRecordRow>(
    `SELECT f.id, f.name, f.size, f.createdAt, f.updatedAt, f.type, f.kind,
            f.localId, f.hash, f.addedAt, f.thumbForId, f.thumbSize, f.trashedAt, f.deletedAt
     FROM files f
     INNER JOIN directories d ON f.directoryId = d.id
     WHERE d.path = ? AND f.kind = 'file'
       AND f.trashedAt IS NULL AND f.deletedAt IS NULL
       AND ${buildLatestVersionFilter('f')}
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

  await rebaseDirectoryTree(db, dirId, dir.path, newPath)

  return toDirectory({ id: dirId, path: newPath, createdAt: dir.createdAt })
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
  const newPath = newParentPath !== null ? `${newParentPath}/${leafName}` : leafName

  if (
    newParentPath !== null &&
    (newParentPath === dir.path || newParentPath.startsWith(`${dir.path}/`))
  ) {
    throw new Error('Cannot move a folder into itself or a subfolder of itself')
  }

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM directories WHERE path = ? AND id != ?',
    newPath,
    dirId,
  )
  if (existing) {
    throw new Error(`Folder "${leafName}" already exists at destination`)
  }

  await rebaseDirectoryTree(db, dirId, dir.path, newPath)
}

async function rebaseDirectoryTree(
  db: DatabaseAdapter,
  dirId: string,
  oldPath: string,
  newPath: string,
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
    await db.runAsync(
      `UPDATE directories SET path = ?, nameSortKey = ? WHERE id = ?`,
      newPath,
      naturalSortKey(newPath),
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

    await db.runAsync(
      `UPDATE files SET updatedAt = ? WHERE directoryId IN (
        SELECT id FROM directories WHERE path = ? OR path LIKE ? || '/%' ESCAPE '\\'
      )`,
      now,
      newPath,
      newEscaped,
    )
  })
}
