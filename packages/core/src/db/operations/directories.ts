import type { DatabaseAdapter } from '../../adapters/db'
import { naturalSortKey } from '../../lib/naturalSortKey'
import { uniqueId } from '../../lib/uniqueId'
import type { FileRecordRow } from '../../types/files'
import * as sql from '../sql'
import {
  recalculateCurrentForGroup,
  recalculateCurrentForGroups,
} from './files'
import { buildLatestVersionFilter } from './library'
import { trashFiles } from './trash'
export type Directory = {
  id: string
  path: string
  createdAt: number
}

export type DirectoryWithCount = Directory & {
  fileCount: number
}

export function sanitizeDirectoryPath(path: string): string {
  let result = ''
  for (const ch of path) {
    const code = ch.codePointAt(0)!
    if (ch === '/' || ch === '\\') continue
    if (code < 0x20 || code === 0x7f) continue
    result += ch
  }
  result = result.trim()
  if (/^\.+$/.test(result)) return ''
  return result.slice(0, 255)
}

export async function insertDirectory(
  db: DatabaseAdapter,
  path: string,
): Promise<Directory> {
  const trimmed = sanitizeDirectoryPath(path)
  if (!trimmed) {
    throw new Error('Folder name cannot be empty')
  }

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM directories WHERE path = ?',
    trimmed,
  )
  if (existing) {
    throw new Error(`Folder "${trimmed}" already exists`)
  }

  const now = Date.now()
  const dir: Directory = {
    id: uniqueId(),
    path: trimmed,
    createdAt: now,
  }

  await sql.insert(db, 'directories', {
    ...dir,
    nameSortKey: naturalSortKey(trimmed),
  })
  return dir
}

export async function getOrCreateDirectory(
  db: DatabaseAdapter,
  path: string,
): Promise<Directory> {
  const trimmed = sanitizeDirectoryPath(path)
  if (!trimmed) {
    throw new Error('Folder name cannot be empty')
  }

  const now = Date.now()
  const id = uniqueId()
  await db.runAsync(
    `INSERT OR IGNORE INTO directories (id, path, createdAt, nameSortKey) VALUES (?, ?, ?, ?)`,
    id,
    trimmed,
    now,
    naturalSortKey(trimmed),
  )

  const dir = await db.getFirstAsync<Directory>(
    'SELECT id, path, createdAt FROM directories WHERE path = ?',
    trimmed,
  )

  if (!dir) {
    throw new Error(`Failed to get or create directory "${trimmed}"`)
  }

  return dir
}

export async function queryAllDirectoriesWithCounts(
  db: DatabaseAdapter,
): Promise<DirectoryWithCount[]> {
  return db.getAllAsync<DirectoryWithCount>(
    `SELECT d.id, d.path, d.createdAt, COUNT(f.id) as fileCount
     FROM directories d
     LEFT JOIN files f ON f.directoryId = d.id AND f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL
       AND ${buildLatestVersionFilter('f')}
     GROUP BY d.id
     ORDER BY d.nameSortKey`,
  )
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
  const dir = await getOrCreateDirectory(db, directoryPath)
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
    const dir = await getOrCreateDirectory(db, path)
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
    await db.runAsync(
      `UPDATE files SET directoryId = ? WHERE id IN (${ph})`,
      dirId,
      ...ids,
    )
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
  await sql.update(
    db,
    'files',
    { directoryId: dirId, updatedAt: Date.now() },
    { id: fileId },
  )
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
  const newGroups = new Map<
    string,
    { name: string; directoryId: string | null }
  >()
  for (const g of groups) {
    const key = `${g.name}|${dirId ?? ''}`
    newGroups.set(key, { name: g.name, directoryId: dirId })
  }
  for (const g of newGroups.values()) {
    await recalculateCurrentForGroup(db, g.name, g.directoryId)
  }
}

export async function deleteDirectory(
  db: DatabaseAdapter,
  id: string,
): Promise<void> {
  const groups = await db.getAllAsync<{ name: string }>(
    `SELECT DISTINCT name FROM files WHERE directoryId = ? AND kind = 'file'`,
    id,
  )
  await db.runAsync(
    'UPDATE files SET directoryId = NULL WHERE directoryId = ?',
    id,
  )
  await sql.del(db, 'directories', { id })
  for (const g of groups) {
    await recalculateCurrentForGroup(db, g.name, null)
  }
}

export async function deleteDirectoryAndTrashFiles(
  db: DatabaseAdapter,
  id: string,
): Promise<string[]> {
  const files = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM files WHERE directoryId = ? AND kind = 'file' AND trashedAt IS NULL AND deletedAt IS NULL`,
    id,
  )
  const fileIds = files.map((f) => f.id)
  if (fileIds.length > 0) {
    await trashFiles(db, fileIds)
  }
  await sql.del(db, 'directories', { id })
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

export async function queryDirectoryByPath(
  db: DatabaseAdapter,
  path: string,
): Promise<Directory | null> {
  return db.getFirstAsync<Directory>(
    'SELECT id, path, createdAt FROM directories WHERE path = ? LIMIT 1',
    path,
  )
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
  path: string,
): Promise<void> {
  const trimmed = sanitizeDirectoryPath(path)
  if (!trimmed) {
    throw new Error('Folder name cannot be empty')
  }

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM directories WHERE path = ? AND id != ?',
    trimmed,
    dirId,
  )
  if (existing) {
    throw new Error(`Folder "${trimmed}" already exists`)
  }

  await sql.update(
    db,
    'directories',
    { path: trimmed, nameSortKey: naturalSortKey(trimmed) },
    { id: dirId },
  )
  const now = Date.now()
  await db.runAsync(
    'UPDATE files SET updatedAt = ? WHERE directoryId = ?',
    now,
    dirId,
  )
}
