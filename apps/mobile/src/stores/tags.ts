import type { Tag, TagWithCount } from '@siastorage/core/db/operations'
import * as ops from '@siastorage/core/db/operations'
import useSWR from 'swr'
import { db } from '../db'
import { swrCacheBy } from '../lib/swr'
import { invalidateCacheLibraryLists } from './librarySwr'

export type { Tag, TagWithCount } from '@siastorage/core/db/operations'
export const SYSTEM_TAGS = ops.SYSTEM_TAGS

export const tagsSwr = swrCacheBy()

let systemTagsEnsured = false
export async function ensureSystemTags(): Promise<void> {
  if (systemTagsEnsured) return
  await ops.ensureSystemTags(db())
  systemTagsEnsured = true
}

export async function createTag(name: string): Promise<Tag> {
  const tag = await ops.insertTag(db(), name)
  tagsSwr.invalidateAll()
  return tag
}

export async function getOrCreateTag(name: string): Promise<Tag> {
  const tag = await ops.getOrCreateTag(db(), name)
  tagsSwr.invalidateAll()
  return tag
}

export async function searchTags(
  query: string,
  limit: number = 10,
): Promise<Tag[]> {
  return ops.queryTagsByPrefix(db(), query, limit)
}

export async function readTagsForFile(fileId: string): Promise<Tag[]> {
  return ops.queryTagsForFile(db(), fileId)
}

export async function readTagNamesForFile(
  fileId: string,
): Promise<string[] | undefined> {
  return ops.queryTagNamesForFile(db(), fileId)
}

export async function readAllTagsWithCounts(): Promise<TagWithCount[]> {
  return ops.queryAllTagsWithCounts(db())
}

export async function addTagToFile(
  fileId: string,
  tagName: string,
): Promise<void> {
  await ops.addTagToFile(db(), fileId, tagName)
  tagsSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

export async function addTagToFiles(
  fileIds: string[],
  tagName: string,
): Promise<void> {
  if (fileIds.length === 0) return
  await ops.addTagToFiles(db(), fileIds, tagName)
  tagsSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

export async function removeTagFromFile(
  fileId: string,
  tagId: string,
): Promise<void> {
  await ops.removeTagFromFile(db(), fileId, tagId)
  tagsSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

export async function syncTagsFromMetadata(
  fileId: string,
  tagNames: string[] | undefined,
): Promise<void> {
  if (tagNames === undefined) {
    return
  }
  await ops.syncTagsFromMetadata(db(), fileId, tagNames)
  tagsSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

export async function toggleFavorite(fileId: string): Promise<void> {
  await ops.toggleFavorite(db(), fileId)
  tagsSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

export async function readIsFavorite(fileId: string): Promise<boolean> {
  return ops.queryIsFavorite(db(), fileId)
}

export async function renameTag(tagId: string, newName: string): Promise<void> {
  await ops.renameTag(db(), tagId, newName)
  tagsSwr.invalidateAll()
  invalidateCacheLibraryLists()
}

export async function deleteTag(tagId: string): Promise<void> {
  await ops.deleteTag(db(), tagId)
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
