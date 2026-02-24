import type { DatabaseAdapter } from '../../adapters/db'
import { uniqueId } from '../../lib/uniqueId'
import { sqlInsert, sqlUpdate } from '../sql'

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
    throw new Error('Directory name cannot be empty')
  }

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM directories WHERE name = ? COLLATE NOCASE',
    trimmed,
  )
  if (existing) {
    throw new Error(`Directory "${trimmed}" already exists`)
  }

  const now = Date.now()
  const dir: Directory = {
    id: uniqueId(),
    name: trimmed,
    createdAt: now,
  }

  await sqlInsert(db, 'directories', dir)
  return dir
}

export async function getOrCreateDirectoryInDb(
  db: DatabaseAdapter,
  name: string,
): Promise<Directory> {
  const trimmed = sanitizeDirectoryName(name)
  if (!trimmed) {
    throw new Error('Directory name cannot be empty')
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
     LEFT JOIN files f ON f.directoryId = d.id AND f.kind = 'file'
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

export async function syncDirectoryFromMetadataInDb(
  db: DatabaseAdapter,
  fileId: string,
  directoryName: string | undefined,
): Promise<void> {
  if (directoryName === undefined) return
  const dir = await getOrCreateDirectoryInDb(db, directoryName)
  await sqlUpdate(db, 'files', { directoryId: dir.id }, { id: fileId })
}
