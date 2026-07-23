import type {
  ImportFileRow,
  ImportRow,
  ImportSource,
  ImportSummary,
} from '@siastorage/core/db/operations'
import { useAllDirectories } from '@siastorage/core/stores'
import { useMemo } from 'react'
import useSWR, { type SWRConfiguration } from 'swr'
import { app } from './appService'

// Every read below keys on `caches.imports`. Row-state writes invalidate that
// cache (debounced), so these hooks refetch as an import drains. Claiming and
// per-copy progress heartbeats do not invalidate.

export async function getImports(opts?: {
  source?: ImportSource
  limit?: number
}): Promise<ImportRow[]> {
  return app().imports.list(opts)
}

/** All imports, newest-first (optionally filtered by source). Drives the Imports list. */
export function useImports(
  opts?: { source?: ImportSource; limit?: number },
  config?: SWRConfiguration,
) {
  const key = app().caches.imports.key('list')
  return useSWR([...key, opts ?? null], () => getImports(opts), config)
}

export async function getImport(id: string): Promise<ImportRow | null> {
  return app().imports.get(id)
}

/** One import row by id. */
export function useImport(id: string | null, config?: SWRConfiguration) {
  const key = app().caches.imports.key('get')
  return useSWR(id ? [...key, id] : null, () => getImport(id as string), config)
}

export async function getImportSummary(ids: string[]): Promise<ImportSummary[]> {
  if (ids.length === 0) return []
  return app().imports.summary(ids)
}

/** Derived status + counts for the given import ids. Drives list rows + the detail header. */
export function useImportSummary(ids: string[], config?: SWRConfiguration) {
  const key = app().caches.imports.key('summary')
  const idsKey = ids.join(',')
  return useSWR(ids.length > 0 ? [...key, idsKey] : null, () => getImportSummary(ids), config)
}

export async function getImportFiles(
  importId: string,
  opts?: { limit?: number; search?: string },
): Promise<ImportFileRow[]> {
  return app().imports.files(importId, opts)
}

/** The import_files rows of one import, newest-first, up to `limit` when given
 * (the detail screen pages by PAGE_SIZE rather than loading a 50k-child scan). */
export function useImportFiles(
  importId: string | null,
  opts?: { limit?: number; search?: string },
  config?: SWRConfiguration,
) {
  const key = app().caches.imports.key('files')
  return useSWR(
    importId ? [...key, importId, opts ?? null] : null,
    () => getImportFiles(importId as string, opts),
    config,
  )
}

export async function getInProgressImport(source: ImportSource): Promise<ImportRow | null> {
  return app().imports.inProgressImport(source)
}

/**
 * Resolves an import's destination directoryId to a display name. Unfiled
 * (`null`) imports go to "Library". A directory deleted out from under an
 * in-flight import (its `directoryId` set NULL) also reads as "Library".
 */
export function useImportDestinationName(directoryId: string | null | undefined): string {
  const { data: directories } = useAllDirectories()
  return useMemo(() => {
    if (!directoryId) return 'Library'
    const dir = directories?.find((d) => d.id === directoryId)
    return dir?.name ?? 'Library'
  }, [directories, directoryId])
}

/** Parses an import's JSON `pendingTags` column into tag names (empty on any error). */
export function parsePendingTags(pendingTags: string | null | undefined): string[] {
  if (!pendingTags) return []
  try {
    const parsed = JSON.parse(pendingTags)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}
