import { swrCache } from '@siastorage/core/stores/swr'
import useSWR from 'swr'

export type AuthStep =
  | 'loading'
  | 'connect'
  | 'approve'
  | 'recovery'
  | 'connected'
  | 'unsupported'
  | 'db-error'

type AuthData = {
  storedKeyHex: string | null
  indexerUrl: string
  step: AuthStep
  error: string | null
  approvalUrl: string | null
}

type StateStorage = {
  getItem(name: string): string | null
  setItem(name: string, value: string): void
  removeItem(name: string): void
}

const STORAGE_KEY = 'sia-web-auth'

let storage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {}
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {}
  },
}

export function setAuthStorage(s: StateStorage): void {
  storage = s
}

function loadPersistedState(): Partial<AuthData> {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw || typeof raw !== 'string') return {}
    const parsed = JSON.parse(raw)
    const persisted = parsed?.state ?? {}
    return {
      storedKeyHex: persisted.storedKeyHex ?? null,
      indexerUrl: persisted.indexerUrl ?? '',
    }
  } catch {
    return {}
  }
}

function persistState() {
  const value = {
    state: {
      storedKeyHex: state.storedKeyHex,
      indexerUrl: state.indexerUrl,
    },
    version: 0,
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(value))
}

const cache = swrCache()

const persisted = loadPersistedState()

let state: AuthData = {
  storedKeyHex: persisted.storedKeyHex ?? null,
  indexerUrl: persisted.indexerUrl ?? '',
  step: 'loading',
  error: null,
  approvalUrl: null,
}

export function setStep(step: AuthStep) {
  state = { ...state, step, error: null }
  cache.invalidate()
}

export function setError(error: string | null) {
  state = { ...state, error }
  cache.invalidate()
}

export function setStoredKeyHex(hex: string) {
  state = { ...state, storedKeyHex: hex }
  persistState()
  cache.invalidate()
}

export function setIndexerUrl(url: string) {
  state = { ...state, indexerUrl: url }
  persistState()
  cache.invalidate()
}

export function setApprovalUrl(url: string | null) {
  state = { ...state, approvalUrl: url }
  cache.invalidate()
}

export function setConnected() {
  state = { ...state, step: 'connected', error: null }
  cache.invalidate()
}

export function resetAuth() {
  state = {
    ...state,
    storedKeyHex: null,
    step: 'loading',
    error: null,
    approvalUrl: null,
  }
  persistState()
  cache.invalidate()
}

const actions = {
  setStep,
  setError,
  setStoredKeyHex,
  setIndexerUrl,
  setApprovalUrl,
  setConnected,
  reset: resetAuth,
}

type AuthFull = AuthData & typeof actions

function getState(): AuthFull {
  return { ...state, ...actions }
}

function useAuthStoreImpl(): AuthFull
function useAuthStoreImpl<T>(selector: (s: AuthFull) => T): T
function useAuthStoreImpl<T>(selector?: (s: AuthFull) => T) {
  const { data } = useSWR(cache.key(), () => state)
  const current = data ?? state
  const full: AuthFull = { ...current, ...actions }
  return selector ? selector(full) : full
}

export const useAuthStore: typeof useAuthStoreImpl & {
  getState: typeof getState
} = Object.assign(useAuthStoreImpl, { getState })
