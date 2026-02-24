import { uniqueId } from '@siastorage/core/lib/uniqueId'
import useSWR from 'swr'
import { db } from '../db'
import { sqlDelete, sqlInsert, sqlUpdate } from '../db/sql'
import { swrCacheBy } from '../lib/swr'
import { invalidateCacheLibraryLists } from './librarySwr'

export const directoriesSwr = swrCacheBy()

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

export async function createDirectory(name: string): Promise<Directory> {
  const trimmed = sanitizeDirectoryName(name)
  if (!trimmed) {
    throw new Error('Directory name cannot be empty')
  }

  const existing = await db().getFirstAsync<{ id: string }>(
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

  await sqlInsert('directories', dir)
  directoriesSwr.invalidate('all')
  return dir
}

export async function getOrCreateDirectory(name: string): Promise<Directory> {
  const trimmed = sanitizeDirectoryName(name)
  if (!trimmed) {
    throw new Error('Directory name cannot be empty')
  }

  const existing = await db().getFirstAsync<Directory>(
    'SELECT id, name, createdAt FROM directories WHERE name = ? COLLATE NOCASE',
    trimmed,
  )

  if (existing) {
    return existing
  }

  return createDirectory(trimmed)
}

export async function readAllDirectoriesWithCounts(): Promise<
  DirectoryWithCount[]
> {
  return db().getAllAsync<DirectoryWithCount>(
    `SELECT d.id, d.name, d.createdAt, COUNT(f.id) as fileCount
     FROM directories d
     LEFT JOIN files f ON f.directoryId = d.id AND f.kind = 'file'
     GROUP BY d.id
     ORDER BY d.name COLLATE NOCASE`,
  )
}

export async function deleteDirectory(id: string): Promise<void> {
  await sqlUpdate('files', { directoryId: null }, { directoryId: id })
  await sqlDelete('directories', { id })
  directoriesSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

export async function renameDirectory(id: string, name: string): Promise<void> {
  const trimmed = sanitizeDirectoryName(name)
  if (!trimmed) {
    throw new Error('Directory name cannot be empty')
  }
  const existing = await db().getFirstAsync<{ id: string }>(
    'SELECT id FROM directories WHERE name = ? COLLATE NOCASE AND id != ?',
    trimmed,
    id,
  )
  if (existing) {
    throw new Error(`Directory "${trimmed}" already exists`)
  }
  await sqlUpdate('directories', { name: trimmed }, { id })
  directoriesSwr.invalidate('all')
  invalidateCacheLibraryLists()
}

export async function moveFileToDirectory(
  fileId: string,
  directoryId: string | null,
): Promise<void> {
  await sqlUpdate(
    'files',
    { directoryId, updatedAt: Date.now() },
    { id: fileId },
  )
  directoriesSwr.invalidate('all')
  directoriesSwr.invalidate(`file/${fileId}`)
  invalidateCacheLibraryLists()
}

export async function moveFilesToDirectory(
  fileIds: string[],
  directoryId: string | null,
): Promise<void> {
  if (fileIds.length === 0) return
  const now = Date.now()
  const placeholders = fileIds.map(() => '?').join(',')
  await db().runAsync(
    `UPDATE files SET directoryId = ?, updatedAt = ? WHERE id IN (${placeholders})`,
    directoryId,
    now,
    ...fileIds,
  )
  directoriesSwr.invalidate('all')
  for (const id of fileIds) {
    directoriesSwr.invalidate(`file/${id}`)
  }
  invalidateCacheLibraryLists()
}

export async function readDirectoryNameForFile(
  fileId: string,
): Promise<string | undefined> {
  const row = await db().getFirstAsync<{ name: string }>(
    `SELECT d.name FROM directories d
     INNER JOIN files f ON f.directoryId = d.id
     WHERE f.id = ?`,
    fileId,
  )
  return row?.name
}

export async function countFilesWithDirectories(
  fileIds: string[],
): Promise<number> {
  if (fileIds.length === 0) return 0
  const placeholders = fileIds.map(() => '?').join(',')
  const row = await db().getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files WHERE id IN (${placeholders}) AND directoryId IS NOT NULL`,
    ...fileIds,
  )
  return row?.count ?? 0
}

export async function syncDirectoryFromMetadata(
  fileId: string,
  directoryName: string | undefined,
): Promise<void> {
  if (directoryName === undefined) return
  const dir = await getOrCreateDirectory(directoryName)
  await sqlUpdate('files', { directoryId: dir.id }, { id: fileId })
  directoriesSwr.invalidate('all')
  directoriesSwr.invalidate(`file/${fileId}`)
  invalidateCacheLibraryLists()
}

// SWR Hooks

export function useAllDirectories() {
  return useSWR(directoriesSwr.key('all'), readAllDirectoriesWithCounts)
}

export function useDirectoryForFile(fileId: string | null) {
  return useSWR(fileId ? directoriesSwr.key(`file/${fileId}`) : null, () =>
    fileId ? readDirectoryNameForFile(fileId) : undefined,
  )
}
