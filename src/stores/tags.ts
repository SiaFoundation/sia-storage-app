import useSWR from 'swr'
import { db, withTransactionLock } from '../db'
import { sqlDelete, sqlInsert, sqlUpdate } from '../db/sql'
import { swrCacheBy } from '../lib/swr'
import { uniqueId } from '../lib/uniqueId'
import { invalidateCacheLibraryLists } from './librarySwr'

export const tagsSwr = swrCacheBy()

/**
 * System tags are auto-created and cannot be deleted.
 * Users can add/remove files from system tags.
 * System tags are synced to metadata like user tags.
 * Auto-created on first use via ensureSystemTags().
 */
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

/**
 * Ensures all system tags exist in the database.
 * Called lazily before operations that reference system tags.
 * Idempotent — uses INSERT OR IGNORE.
 */
let systemTagsEnsured = false
export async function ensureSystemTags(): Promise<void> {
  if (systemTagsEnsured) return
  const now = Date.now()
  for (const tag of Object.values(SYSTEM_TAGS)) {
    await db().runAsync(
      `INSERT OR IGNORE INTO tags (id, name, createdAt, usedAt, system) VALUES (?, ?, ?, ?, 1)`,
      tag.id,
      tag.name,
      now,
      now,
    )
  }
  systemTagsEnsured = true
}

/**
 * Creates a new user tag.
 * @throws if name is empty or tag with same name exists (case-insensitive)
 */
export async function createTag(name: string): Promise<Tag> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Tag name cannot be empty')
  }

  const existing = await db().getFirstAsync<{ id: string }>(
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

  await sqlInsert('tags', tag)
  tagsSwr.invalidateAll()
  return tag
}

/**
 * Gets an existing tag by name (case-insensitive) or creates a new one.
 * Updates usedAt timestamp when getting existing tag.
 */
export async function getOrCreateTag(name: string): Promise<Tag> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('Tag name cannot be empty')
  }

  const existing = await db().getFirstAsync<Tag>(
    'SELECT id, name, createdAt, usedAt, system FROM tags WHERE name = ? COLLATE NOCASE',
    trimmed,
  )

  if (existing) {
    const now = Date.now()
    await db().runAsync(
      'UPDATE tags SET usedAt = ? WHERE id = ?',
      now,
      existing.id,
    )
    tagsSwr.invalidateAll()
    return { ...existing, usedAt: now }
  }

  return createTag(trimmed)
}

/**
 * Searches tags by name prefix for autocomplete.
 * Returns tags ordered by most recently used.
 */
export async function searchTags(
  query: string,
  limit: number = 10,
): Promise<Tag[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    return db().getAllAsync<Tag>(
      'SELECT id, name, createdAt, usedAt, system FROM tags ORDER BY usedAt DESC LIMIT ?',
      limit,
    )
  }

  const escaped = trimmed.replace(/[%_\\]/g, (m) => `\\${m}`)
  return db().getAllAsync<Tag>(
    `SELECT id, name, createdAt, usedAt, system FROM tags
     WHERE name LIKE ? COLLATE NOCASE ESCAPE '\\'
     ORDER BY usedAt DESC
     LIMIT ?`,
    `${escaped}%`,
    limit,
  )
}

/**
 * Reads all tags for a file, ordered by name.
 */
export async function readTagsForFile(fileId: string): Promise<Tag[]> {
  return db().getAllAsync<Tag>(
    `SELECT t.id, t.name, t.createdAt, t.usedAt, t.system
     FROM tags t
     INNER JOIN file_tags ft ON ft.tagId = t.id
     WHERE ft.fileId = ?
     ORDER BY t.name COLLATE NOCASE`,
    fileId,
  )
}

/**
 * Reads tag names for a file, for use in metadata sync.
 * Returns undefined if no tags (to avoid serializing empty arrays).
 */
export async function readTagNamesForFile(
  fileId: string,
): Promise<string[] | undefined> {
  const tags = await readTagsForFile(fileId)
  return tags.length > 0 ? tags.map((t) => t.name) : undefined
}

/**
 * Reads all tags with their file counts.
 */
export async function readAllTagsWithCounts(): Promise<TagWithCount[]> {
  return db().getAllAsync<TagWithCount>(
    `SELECT t.id, t.name, t.createdAt, t.usedAt, t.system, COUNT(f.id) as fileCount
     FROM tags t
     LEFT JOIN file_tags ft ON ft.tagId = t.id
     LEFT JOIN files f ON f.id = ft.fileId AND f.kind = 'file'
     GROUP BY t.id
     ORDER BY t.system DESC, t.name COLLATE NOCASE`,
  )
}

/**
 * Adds a tag to a file. Creates the tag if it doesn't exist.
 * Ignores if the relationship already exists.
 */
export async function addTagToFile(
  fileId: string,
  tagName: string,
): Promise<void> {
  await withTransactionLock(async () => {
    const tag = await getOrCreateTag(tagName)
    await sqlInsert(
      'file_tags',
      { fileId, tagId: tag.id },
      { conflictClause: 'OR IGNORE' },
    )
    await sqlUpdate('files', { updatedAt: Date.now() }, { id: fileId })
  })
  tagsSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

/**
 * Removes a tag from a file.
 */
export async function removeTagFromFile(
  fileId: string,
  tagId: string,
): Promise<void> {
  await sqlDelete('file_tags', { fileId, tagId })
  await sqlUpdate('files', { updatedAt: Date.now() }, { id: fileId })
  tagsSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

/**
 * Syncs file tags from metadata tag names.
 * Clears existing user tags and re-creates relationships from metadata.
 * System tags in the incoming list are matched by name to existing system tags.
 * Used during down sync to populate junction table from metadata.
 */
export async function syncTagsFromMetadata(
  fileId: string,
  tagNames: string[] | undefined,
): Promise<void> {
  if (tagNames === undefined) {
    return
  }
  await ensureSystemTags()
  await withTransactionLock(async () => {
    // Only clear non-system tag associations; keep system tags intact
    await db().runAsync(
      `DELETE FROM file_tags WHERE fileId = ? AND tagId NOT IN (
        SELECT id FROM tags WHERE system = 1
      )`,
      fileId,
    )

    for (const name of tagNames) {
      const tag = await getOrCreateTag(name)
      await sqlInsert(
        'file_tags',
        { fileId, tagId: tag.id },
        { conflictClause: 'OR IGNORE' },
      )
    }
  })
  tagsSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

/**
 * Toggles the Favorites system tag on a file.
 */
export async function toggleFavorite(fileId: string): Promise<void> {
  const tagId = SYSTEM_TAGS.favorites.id
  const existing = await db().getFirstAsync<{ tagId: string }>(
    'SELECT tagId FROM file_tags WHERE fileId = ? AND tagId = ?',
    fileId,
    tagId,
  )

  if (existing) {
    await sqlDelete('file_tags', { fileId, tagId })
  } else {
    await sqlInsert(
      'file_tags',
      { fileId, tagId },
      { conflictClause: 'OR IGNORE' },
    )
  }
  await sqlUpdate('files', { updatedAt: Date.now() }, { id: fileId })
  tagsSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

/**
 * Checks if a file is favorited.
 */
export async function readIsFavorite(fileId: string): Promise<boolean> {
  const row = await db().getFirstAsync<{ tagId: string }>(
    'SELECT tagId FROM file_tags WHERE fileId = ? AND tagId = ?',
    fileId,
    SYSTEM_TAGS.favorites.id,
  )
  return !!row
}

/**
 * Deletes a tag. System tags cannot be deleted.
 */
export async function deleteTag(tagId: string): Promise<void> {
  const tag = await db().getFirstAsync<Tag>(
    'SELECT id, name, createdAt, usedAt, system FROM tags WHERE id = ?',
    tagId,
  )
  if (!tag) return
  if (tag.system) {
    throw new Error('System tags cannot be deleted')
  }
  await sqlDelete('file_tags', { tagId })
  await sqlDelete('tags', { id: tagId })
  tagsSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

// SWR Hooks

export function useAllTags() {
  return useSWR(tagsSwr.key('all'), readAllTagsWithCounts)
}

export function useTagsForFile(fileId: string | null) {
  return useSWR(fileId ? tagsSwr.key(`file/${fileId}`) : null, () =>
    fileId ? readTagsForFile(fileId) : [],
  )
}

export function useTagSearch(query: string) {
  return useSWR(tagsSwr.key(`search/${query}`), () => searchTags(query))
}

export function useIsFavorite(fileId: string | null) {
  return useSWR(fileId ? tagsSwr.key(`favorite/${fileId}`) : null, () =>
    fileId ? readIsFavorite(fileId) : false,
  )
}
