import type { DatabaseAdapter } from '../../adapters/db'
import { uniqueId } from '../../lib/uniqueId'
import * as sql from '../sql'

export const SYSTEM_TAGS = {
  favorites: { id: 'sys:favorites', name: 'Favorites' },
} as const

export type Tag = {
  id: string
  name: string
  createdAt: number
  usedAt: number
  system: number
}

export type TagWithCount = Tag & {
  fileCount: number
}

export async function ensureSystemTags(db: DatabaseAdapter): Promise<void> {
  const now = Date.now()
  for (const tag of Object.values(SYSTEM_TAGS)) {
    await db.runAsync(
      `INSERT OR IGNORE INTO tags (id, name, createdAt, usedAt, system) VALUES (?, ?, ?, ?, 1)`,
      tag.id,
      tag.name,
      now,
      now,
    )
  }
}

export async function insertTag(db: DatabaseAdapter, name: string): Promise<Tag> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Tag name cannot be empty')
  }

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM tags WHERE name = ?',
    trimmed,
  )
  if (existing) {
    throw new Error(`Tag "${trimmed}" already exists`)
  }

  const now = Date.now()
  const tag: Tag = {
    id: uniqueId(),
    name: trimmed,
    createdAt: now,
    usedAt: now,
    system: 0,
  }

  await sql.insert(db, 'tags', tag)
  return tag
}

export async function getOrCreateTag(db: DatabaseAdapter, name: string): Promise<Tag> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Tag name cannot be empty')
  }

  const now = Date.now()
  const id = uniqueId()
  await db.runAsync(
    `INSERT OR IGNORE INTO tags (id, name, createdAt, usedAt, system) VALUES (?, ?, ?, ?, 0)`,
    id,
    trimmed,
    now,
    now,
  )

  const tag = await db.getFirstAsync<Tag>(
    'SELECT id, name, createdAt, usedAt, system FROM tags WHERE name = ?',
    trimmed,
  )

  if (!tag) {
    throw new Error(`Failed to get or create tag "${trimmed}"`)
  }

  await db.runAsync('UPDATE tags SET usedAt = ? WHERE id = ?', now, tag.id)
  return { ...tag, usedAt: now }
}

export async function queryTagsForFile(db: DatabaseAdapter, fileId: string): Promise<Tag[]> {
  return db.getAllAsync<Tag>(
    `SELECT t.id, t.name, t.createdAt, t.usedAt, t.system
     FROM tags t
     INNER JOIN file_tags ft ON ft.tagId = t.id
     WHERE ft.fileId = ?
     ORDER BY t.name`,
    fileId,
  )
}

export async function queryTagNamesForFile(
  db: DatabaseAdapter,
  fileId: string,
): Promise<string[] | undefined> {
  const tags = await queryTagsForFile(db, fileId)
  return tags.length > 0 ? tags.map((t) => t.name) : undefined
}

export async function queryAllTagsWithCounts(db: DatabaseAdapter): Promise<TagWithCount[]> {
  return db.getAllAsync<TagWithCount>(
    `SELECT t.id, t.name, t.createdAt, t.usedAt, t.system, COUNT(f.id) as fileCount
     FROM tags t
     LEFT JOIN file_tags ft ON ft.tagId = t.id
     LEFT JOIN files f ON f.id = ft.fileId AND f.kind = 'file' AND f.trashedAt IS NULL AND f.deletedAt IS NULL
     GROUP BY t.id
     ORDER BY t.system DESC, t.name`,
  )
}

export async function syncTagsFromMetadata(
  db: DatabaseAdapter,
  fileId: string,
  tagNames: string[] | undefined,
): Promise<void> {
  if (tagNames === undefined) {
    return
  }
  await ensureSystemTags(db)
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `DELETE FROM file_tags WHERE fileId = ? AND tagId NOT IN (
        SELECT id FROM tags WHERE system = 1
      )`,
      fileId,
    )

    for (const name of tagNames) {
      const tag = await getOrCreateTag(db, name)
      await sql.insert(db, 'file_tags', { fileId, tagId: tag.id }, { conflictClause: 'OR IGNORE' })
    }
  })
}

export async function syncManyTagsFromMetadata(
  db: DatabaseAdapter,
  entries: { fileId: string; tagNames: string[] }[],
): Promise<void> {
  if (entries.length === 0) return
  await ensureSystemTags(db)

  const allTagNames = new Set<string>()
  for (const entry of entries) {
    for (const name of entry.tagNames) {
      allTagNames.add(name)
    }
  }

  const tagMap = new Map<string, string>()
  for (const name of allTagNames) {
    const tag = await getOrCreateTag(db, name)
    tagMap.set(name, tag.id)
  }

  const fileIds = entries.map((e) => e.fileId)
  const placeholders = fileIds.map(() => '?').join(',')
  await db.runAsync(
    `DELETE FROM file_tags WHERE fileId IN (${placeholders}) AND tagId NOT IN (
      SELECT id FROM tags WHERE system = 1
    )`,
    ...fileIds,
  )

  const fileTagRows: { fileId: string; tagId: string }[] = []
  for (const entry of entries) {
    for (const name of entry.tagNames) {
      const tagId = tagMap.get(name)
      if (tagId) {
        fileTagRows.push({ fileId: entry.fileId, tagId })
      }
    }
  }
  if (fileTagRows.length > 0) {
    await sql.insertMany(db, 'file_tags', fileTagRows, {
      conflictClause: 'OR IGNORE',
    })
  }
}

export async function insertFileTag(
  db: DatabaseAdapter,
  fileId: string,
  tagId: string,
): Promise<void> {
  await sql.insert(db, 'file_tags', { fileId, tagId }, { conflictClause: 'OR IGNORE' })
}

export async function queryTagsByPrefix(
  db: DatabaseAdapter,
  query: string,
  limit: number = 10,
): Promise<Tag[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    return db.getAllAsync<Tag>(
      'SELECT id, name, createdAt, usedAt, system FROM tags ORDER BY usedAt DESC LIMIT ?',
      limit,
    )
  }

  const escaped = trimmed.replace(/[%_\\]/g, (m) => `\\${m}`)
  return db.getAllAsync<Tag>(
    `SELECT id, name, createdAt, usedAt, system FROM tags
     WHERE name LIKE ? COLLATE NOCASE ESCAPE '\\'
     ORDER BY usedAt DESC
     LIMIT ?`,
    `${escaped}%`,
    limit,
  )
}

export async function toggleFavorite(db: DatabaseAdapter, fileId: string): Promise<void> {
  const tagId = SYSTEM_TAGS.favorites.id
  const existing = await db.getFirstAsync<{ tagId: string }>(
    'SELECT tagId FROM file_tags WHERE fileId = ? AND tagId = ?',
    fileId,
    tagId,
  )

  if (existing) {
    await sql.del(db, 'file_tags', { fileId, tagId })
  } else {
    await sql.insert(db, 'file_tags', { fileId, tagId }, { conflictClause: 'OR IGNORE' })
  }
  await sql.update(db, 'files', { updatedAt: Date.now() }, { id: fileId })
}

export async function queryIsFavorite(db: DatabaseAdapter, fileId: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ tagId: string }>(
    'SELECT tagId FROM file_tags WHERE fileId = ? AND tagId = ?',
    fileId,
    SYSTEM_TAGS.favorites.id,
  )
  return !!row
}

export async function renameTag(db: DatabaseAdapter, tagId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Tag name cannot be empty')
  }

  const tag = await db.getFirstAsync<Tag>(
    'SELECT id, name, createdAt, usedAt, system FROM tags WHERE id = ?',
    tagId,
  )
  if (!tag) return
  if (tag.system) {
    throw new Error('System tags cannot be renamed')
  }

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM tags WHERE name = ? AND id != ?',
    trimmed,
    tagId,
  )
  if (existing) {
    throw new Error(`Tag "${trimmed}" already exists`)
  }

  const now = Date.now()
  await sql.update(db, 'tags', { name: trimmed }, { id: tagId })
  await db.runAsync(
    'UPDATE files SET updatedAt = ? WHERE id IN (SELECT fileId FROM file_tags WHERE tagId = ?)',
    now,
    tagId,
  )
}

export async function deleteTag(db: DatabaseAdapter, tagId: string): Promise<void> {
  const tag = await db.getFirstAsync<Tag>(
    'SELECT id, name, createdAt, usedAt, system FROM tags WHERE id = ?',
    tagId,
  )
  if (!tag) return
  if (tag.system) {
    throw new Error('System tags cannot be deleted')
  }
  await db.withTransactionAsync(async () => {
    await sql.del(db, 'file_tags', { tagId })
    await sql.del(db, 'tags', { id: tagId })
  })
}

export async function addTagToFile(
  db: DatabaseAdapter,
  fileId: string,
  tagName: string,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    const tag = await getOrCreateTag(db, tagName)
    await sql.insert(db, 'file_tags', { fileId, tagId: tag.id }, { conflictClause: 'OR IGNORE' })
    await sql.update(db, 'files', { updatedAt: Date.now() }, { id: fileId })
  })
}

export async function addTagToFiles(
  db: DatabaseAdapter,
  fileIds: string[],
  tagName: string,
): Promise<void> {
  if (fileIds.length === 0) return
  await db.withTransactionAsync(async () => {
    const tag = await getOrCreateTag(db, tagName)
    for (const fileId of fileIds) {
      await sql.insert(db, 'file_tags', { fileId, tagId: tag.id }, { conflictClause: 'OR IGNORE' })
    }
    const now = Date.now()
    const placeholders = fileIds.map(() => '?').join(',')
    await db.runAsync(
      `UPDATE files SET updatedAt = ? WHERE id IN (${placeholders})`,
      now,
      ...fileIds,
    )
  })
}

export async function removeTagFromFile(
  db: DatabaseAdapter,
  fileId: string,
  tagId: string,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await sql.del(db, 'file_tags', { fileId, tagId })
    await sql.update(db, 'files', { updatedAt: Date.now() }, { id: fileId })
  })
}

export async function removeTagFromFiles(
  db: DatabaseAdapter,
  fileIds: string[],
  tagId: string,
): Promise<void> {
  if (fileIds.length === 0) return
  await db.withTransactionAsync(async () => {
    const placeholders = fileIds.map(() => '?').join(',')
    await db.runAsync(
      `DELETE FROM file_tags WHERE tagId = ? AND fileId IN (${placeholders})`,
      tagId,
      ...fileIds,
    )
    const now = Date.now()
    await db.runAsync(
      `UPDATE files SET updatedAt = ? WHERE id IN (${placeholders})`,
      now,
      ...fileIds,
    )
  })
}
