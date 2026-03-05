import type { DatabaseAdapter } from '../../adapters/db'
import { uniqueId } from '../../lib/uniqueId'
import * as sql from '../sql'
import { trashFiles } from './trash'
export type Directory = {
  id: string
  name: string
  createdAt: number
}

export type DirectoryWithCount = Directory & {
  fileCount: number
}

export function sanitizeDirectoryName(name: string): string {
  let result = ''
  for (const ch of name) {
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
  name: string,
): Promise<Directory> {
  const trimmed = sanitizeDirectoryName(name)
  if (!trimmed) {
    throw new Error('Folder name cannot be empty')
  }

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM directories WHERE name = ? COLLATE NOCASE',
    trimmed,
  )
  if (existing) {
    throw new Error(`Folder "${trimmed}" already exists`)
  }

  const now = Date.now()
  const dir: Directory = {
    id: uniqueId(),
    name: trimmed,
    createdAt: now,
  }

  await sql.insert(db, 'directories', dir)
  return dir
}

export async function getOrCreateDirectory(
  db: DatabaseAdapter,
  name: string,
): Promise<Directory> {
  const trimmed = sanitizeDirectoryName(name)
  if (!trimmed) {
    throw new Error('Folder name cannot be empty')
  }

  const now = Date.now()
  const id = uniqueId()
  await db.runAsync(
    `INSERT OR IGNORE INTO directories (id, name, createdAt) VALUES (?, ?, ?)`,
    id,
    trimmed,
    now,
  )

  const dir = await db.getFirstAsync<Directory>(
    'SELECT id, name, createdAt FROM directories WHERE name = ? COLLATE NOCASE',
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
    `SELECT d.id, d.name, d.createdAt, COUNT(f.id) as fileCount
     FROM directories d
     LEFT JOIN files f ON f.directoryId = d.id AND f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL
     GROUP BY d.id
     ORDER BY d.name COLLATE NOCASE`,
  )
}

export async function queryDirectoryNameForFile(
  db: DatabaseAdapter,
  fileId: string,
): Promise<string | undefined> {
  const row = await db.getFirstAsync<{ name: string }>(
    `SELECT d.name FROM directories d
     INNER JOIN files f ON f.directoryId = d.id
     WHERE f.id = ?`,
    fileId,
  )
  return row?.name
}

export async function syncDirectoryFromMetadata(
  db: DatabaseAdapter,
  fileId: string,
  directoryName: string | undefined,
): Promise<void> {
  if (directoryName === undefined) return
  const dir = await getOrCreateDirectory(db, directoryName)
  await sql.update(db, 'files', { directoryId: dir.id }, { id: fileId })
}

export async function moveFileToDirectory(
  db: DatabaseAdapter,
  fileId: string,
  dirId: string | null,
): Promise<void> {
  await sql.update(
    db,
    'files',
    { directoryId: dirId, updatedAt: Date.now() },
    { id: fileId },
  )
}

export async function moveFilesToDirectory(
  db: DatabaseAdapter,
  fileIds: string[],
  dirId: string | null,
): Promise<void> {
  if (fileIds.length === 0) return
  const now = Date.now()
  const placeholders = fileIds.map(() => '?').join(',')
  await db.runAsync(
    `UPDATE files SET directoryId = ?, updatedAt = ? WHERE id IN (${placeholders})`,
    dirId,
    now,
    ...fileIds,
  )
}

export async function deleteDirectory(
  db: DatabaseAdapter,
  id: string,
): Promise<void> {
  await db.runAsync(
    'UPDATE files SET directoryId = NULL WHERE directoryId = ?',
    id,
  )
  await sql.del(db, 'directories', { id })
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

export async function renameDirectory(
  db: DatabaseAdapter,
  dirId: string,
  name: string,
): Promise<void> {
  const trimmed = sanitizeDirectoryName(name)
  if (!trimmed) {
    throw new Error('Folder name cannot be empty')
  }

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM directories WHERE name = ? COLLATE NOCASE AND id != ?',
    trimmed,
    dirId,
  )
  if (existing) {
    throw new Error(`Folder "${trimmed}" already exists`)
  }

  await sql.update(db, 'directories', { name: trimmed }, { id: dirId })
  const now = Date.now()
  await db.runAsync(
    'UPDATE files SET updatedAt = ? WHERE directoryId = ?',
    now,
    dirId,
  )
}
