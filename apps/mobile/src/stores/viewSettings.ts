import type { Category, SortBy, SortDir } from '@siastorage/core/db/operations'
import { swrCache } from '@siastorage/core/stores'
import useSWR from 'swr'
import { app } from './appService'

export type ViewSettings = {
  viewMode: 'gallery' | 'list'
  sortBy: SortBy
  sortDir: SortDir
  selectedCategories: Category[]
}

const GALLERY_DEFAULTS: ViewSettings = {
  viewMode: 'gallery',
  sortBy: 'DATE',
  sortDir: 'DESC',
  selectedCategories: [],
}

const LIST_DEFAULTS: ViewSettings = {
  viewMode: 'list',
  sortBy: 'DATE',
  sortDir: 'DESC',
  selectedCategories: [],
}

function defaultsForScope(scope: string): ViewSettings {
  if (scope === 'library' || scope === 'search') return GALLERY_DEFAULTS
  return LIST_DEFAULTS
}

const cache = swrCache()
let settings: Record<string, ViewSettings> = {}
let loaded = false
let loadPromise: Promise<void> | null = null

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const stored = (await app().settings.getViewSettings()) as Record<string, ViewSettings>
    settings = stored ?? {}
    loaded = true
    cache.invalidate()
  })()
  return loadPromise
}

async function persist() {
  await app().settings.setViewSettings(settings)
}

function getSettings(scope: string): ViewSettings {
  return settings[scope] ?? defaultsForScope(scope)
}

function updateScope(scope: string, patch: Partial<ViewSettings>) {
  const current = settings[scope] ?? defaultsForScope(scope)
  settings = {
    ...settings,
    [scope]: { ...current, ...patch },
  }
  cache.invalidate()
  void persist()
}

export function useViewSettings(scope: string): ViewSettings {
  void ensureLoaded()
  const { data } = useSWR(cache.key(), () => ({ settings }))
  const s = data?.settings ?? settings
  return s[scope] ?? defaultsForScope(scope)
}

export function setViewMode(scope: string, viewMode: 'gallery' | 'list') {
  updateScope(scope, { viewMode })
}

export function setSortBy(scope: string, sortBy: SortBy) {
  updateScope(scope, { sortBy })
}

export function setSortDir(scope: string, sortDir: SortDir) {
  updateScope(scope, { sortDir })
}

export function toggleCategory(scope: string, category: Category) {
  const current = getSettings(scope)
  const set = new Set(current.selectedCategories)
  set.has(category) ? set.delete(category) : set.add(category)
  updateScope(scope, { selectedCategories: Array.from(set) })
}

export function clearCategories(scope: string) {
  updateScope(scope, { selectedCategories: [] })
}

export function resetViewSettings() {
  settings = {}
  loaded = false
  loadPromise = null
  cache.invalidate()
  void app().settings.setViewSettings({})
}
