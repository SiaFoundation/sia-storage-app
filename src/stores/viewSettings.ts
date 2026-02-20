import { create } from 'zustand'
import {
  getAsyncStorageJSON,
  type JsonCodec,
  setAsyncStorageJSON,
} from './asyncStore'
import type { Category, SortBy, SortDir } from './library'

export type ViewSettings = {
  viewMode: 'gallery' | 'list'
  sortBy: SortBy
  sortDir: SortDir
  selectedCategories: Category[]
}

type StoredMap = Record<string, ViewSettings>

const codec: JsonCodec<StoredMap, StoredMap> = {
  encode: (v) => v,
  decode: (v) => v,
}

const STORAGE_KEY = 'viewSettings'

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

type ViewSettingsState = {
  settings: Record<string, ViewSettings>
  loaded: boolean
}

const useViewSettingsStore = create<ViewSettingsState>(() => ({
  settings: {},
  loaded: false,
}))

let loadPromise: Promise<void> | null = null

async function ensureLoaded(): Promise<void> {
  if (useViewSettingsStore.getState().loaded) return
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const stored = await getAsyncStorageJSON<StoredMap, StoredMap>(
      STORAGE_KEY,
      codec,
    )

    useViewSettingsStore.setState({
      settings: stored ?? {},
      loaded: true,
    })
  })()
  return loadPromise
}

async function persist() {
  const { settings } = useViewSettingsStore.getState()
  await setAsyncStorageJSON(STORAGE_KEY, settings, codec)
}

function getSettings(scope: string): ViewSettings {
  const { settings } = useViewSettingsStore.getState()
  return settings[scope] ?? defaultsForScope(scope)
}

function updateScope(scope: string, patch: Partial<ViewSettings>) {
  useViewSettingsStore.setState((state) => {
    const current = state.settings[scope] ?? defaultsForScope(scope)
    return {
      settings: {
        ...state.settings,
        [scope]: { ...current, ...patch },
      },
    }
  })
  void persist()
}

export function useViewSettings(scope: string): ViewSettings {
  void ensureLoaded()
  return useViewSettingsStore((state) => {
    return state.settings[scope] ?? defaultsForScope(scope)
  })
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
  useViewSettingsStore.setState({ settings: {}, loaded: false })
  loadPromise = null
  void setAsyncStorageJSON(STORAGE_KEY, {}, codec)
}
