import { swrCache } from '@siastorage/core/stores/swr'
import { useMemo } from 'react'
import useSWR from 'swr'

export type ViewMode = 'gallery' | 'list'
export type SortBy = 'DATE' | 'ADDED' | 'NAME' | 'SIZE'
export type SortDir = 'ASC' | 'DESC'
export type Category = 'Image' | 'Video' | 'Audio' | 'Files'

export type ViewSettings = {
  viewMode: ViewMode
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

const NAME_ASC_GALLERY_DEFAULTS: ViewSettings = {
  viewMode: 'gallery',
  sortBy: 'NAME',
  sortDir: 'ASC',
  selectedCategories: [],
}

function defaultsForScope(scope: string): ViewSettings {
  if (scope === 'library' || scope === 'search') return GALLERY_DEFAULTS
  if (scope === 'directories' || scope === 'tags')
    return NAME_ASC_GALLERY_DEFAULTS
  return LIST_DEFAULTS
}

const STORAGE_KEY = 'viewSettings'

type StorageBackend = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

let storageBackend: StorageBackend = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value)
    } catch {}
  },
}

export function setViewSettingsStorage(backend: StorageBackend): void {
  storageBackend = backend
}

function loadAll(): Record<string, ViewSettings> {
  try {
    const raw = storageBackend.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function persistAll(settings: Record<string, ViewSettings>) {
  storageBackend.setItem(STORAGE_KEY, JSON.stringify(settings))
}

const cache = swrCache()

let settings: Record<string, ViewSettings> = loadAll()

function updateScope(scope: string, patch: Partial<ViewSettings>) {
  const current = settings[scope] ?? defaultsForScope(scope)
  settings = { ...settings, [scope]: { ...current, ...patch } }
  persistAll(settings)
  cache.invalidate()
}

export function setViewMode(scope: string, mode: ViewMode) {
  updateScope(scope, { viewMode: mode })
}

export function setSortBy(scope: string, sortBy: SortBy) {
  updateScope(scope, { sortBy })
}

export function setSortDir(scope: string, dir: SortDir) {
  updateScope(scope, { sortDir: dir })
}

export function toggleCategory(scope: string, category: Category) {
  const current = settings[scope] ?? defaultsForScope(scope)
  const cats = current.selectedCategories.includes(category)
    ? current.selectedCategories.filter((c) => c !== category)
    : [...current.selectedCategories, category]
  updateScope(scope, { selectedCategories: cats })
}

export function clearCategories(scope: string) {
  updateScope(scope, { selectedCategories: [] })
}

const actions = {
  setViewMode,
  setSortBy,
  setSortDir,
  toggleCategory,
  clearCategories,
}

type ViewSettingsFull = {
  settings: Record<string, ViewSettings>
} & typeof actions

export function useViewSettingsStore<T>(
  selector: (s: ViewSettingsFull) => T,
): T {
  const { data } = useSWR(cache.key(), () => settings)
  const current = data ?? settings
  return selector({ settings: current, ...actions })
}

export function useViewSettings(scope: string): ViewSettings {
  const stored = useViewSettingsStore((s) => s.settings[scope])
  return useMemo(() => stored ?? defaultsForScope(scope), [stored, scope])
}
