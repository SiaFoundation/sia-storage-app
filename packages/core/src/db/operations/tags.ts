import type { DatabaseAdapter } from '../../adapters/db'
import { uniqueId } from '../../lib/uniqueId'
import { sqlDelete, sqlInsert } from '../sql'

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

export async function ensureSystemTagsInDb(db: DatabaseAdapter): Promise<void> {
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

export async function insertTag(
  db: DatabaseAdapter,
  name: string,
): Promise<Tag> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Tag name cannot be empty')
  }

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM tags WHERE name = ? COLLATE NOCASE',
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

  await sqlInsert(db, 'tags', tag)
  return tag
}

export async function getOrCreateTagInDb(
  db: DatabaseAdapter,
  name: string,
): Promise<Tag> {
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
    'SELECT id, name, createdAt, usedAt, system FROM tags WHERE name = ? COLLATE NOCASE',
    trimmed,
  )

  if (!tag) {
    throw new Error(`Failed to get or create tag "${trimmed}"`)
  }

  await db.runAsync('UPDATE tags SET usedAt = ? WHERE id = ?', now, tag.id)
  return { ...tag, usedAt: now }
}

export async function queryTagsForFile(
  db: DatabaseAdapter,
  fileId: string,
): Promise<Tag[]> {
  return db.getAllAsync<Tag>(
    `SELECT t.id, t.name, t.createdAt, t.usedAt, t.system
     FROM tags t
     INNER JOIN file_tags ft ON ft.tagId = t.id
     WHERE ft.fileId = ?
     ORDER BY t.name COLLATE NOCASE`,
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

export async function queryAllTagsWithCounts(
  db: DatabaseAdapter,
): Promise<TagWithCount[]> {
  return db.getAllAsync<TagWithCount>(
    `SELECT t.id, t.name, t.createdAt, t.usedAt, t.system, COUNT(f.id) as fileCount
     FROM tags t
     LEFT JOIN file_tags ft ON ft.tagId = t.id
     LEFT JOIN files f ON f.id = ft.fileId AND f.kind = 'file'
     GROUP BY t.id
     ORDER BY t.system DESC, t.name COLLATE NOCASE`,
  )
}

export async function syncTagsFromMetadataInDb(
  db: DatabaseAdapter,
  fileId: string,
  tagNames: string[] | undefined,
): Promise<void> {
  if (tagNames === undefined) {
    return
  }
  await ensureSystemTagsInDb(db)
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `DELETE FROM file_tags WHERE fileId = ? AND tagId NOT IN (
        SELECT id FROM tags WHERE system = 1
      )`,
      fileId,
    )

    for (const name of tagNames) {
      const tag = await getOrCreateTagInDb(db, name)
      await sqlInsert(
        db,
        'file_tags',
        { fileId, tagId: tag.id },
        { conflictClause: 'OR IGNORE' },
      )
    }
  })
}

export async function deleteTagById(
  db: DatabaseAdapter,
  tagId: string,
): Promise<void> {
  const tag = await db.getFirstAsync<Tag>(
    'SELECT id, name, createdAt, usedAt, system FROM tags WHERE id = ?',
    tagId,
  )
  if (!tag) return
  if (tag.system) {
    throw new Error('System tags cannot be deleted')
  }
  await db.withTransactionAsync(async () => {
    await sqlDelete(db, 'file_tags', { tagId })
    await sqlDelete(db, 'tags', { id: tagId })
  })
}
