import { useMemo, useSyncExternalStore } from 'react'

export type Route =
  | { type: 'library'; tab: 'media' }
  | { type: 'library'; tab: 'files' }
  | { type: 'library'; tab: 'tags' }
  | { type: 'library'; tab: 'uploads' }
  | { type: 'directory'; id: string }
  | { type: 'tag'; id: string }
  | { type: 'file'; id: string }
  | { type: 'search'; query: string }
  | { type: 'settings' }

const LAST_TAB_KEY = 'sia_lastTab'
const VALID_TABS = new Set(['files', 'tags', 'media', 'uploads'])

function getLastTab(): string {
  try {
    const stored = localStorage.getItem(LAST_TAB_KEY)
    if (stored && VALID_TABS.has(stored)) return stored
  } catch {}
  return 'files'
}

function setLastTab(tab: string) {
  try {
    localStorage.setItem(LAST_TAB_KEY, tab)
  } catch {}
}

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')

  if (path === '' || path === '/') {
    const lastTab = getLastTab()
    return {
      type: 'library',
      tab: lastTab as 'files' | 'tags' | 'media' | 'uploads',
    }
  }
  if (path === 'files') return { type: 'library', tab: 'files' }
  if (path === 'tags') return { type: 'library', tab: 'tags' }
  if (path === 'media') return { type: 'library', tab: 'media' }
  if (path === 'uploads') return { type: 'library', tab: 'uploads' }
  if (path === 'settings') return { type: 'settings' }

  if (path === 'search' || path.startsWith('search?')) {
    const params = new URLSearchParams(path.replace(/^search\??/, ''))
    return { type: 'search', query: params.get('q') ?? '' }
  }

  const dirMatch = path.match(/^dir\/(.+)$/)
  if (dirMatch) return { type: 'directory', id: dirMatch[1] }

  const tagMatch = path.match(/^tag\/(.+)$/)
  if (tagMatch) return { type: 'tag', id: tagMatch[1] }

  const fileMatch = path.match(/^file\/(.+)$/)
  if (fileMatch) return { type: 'file', id: fileMatch[1] }

  const lastTab = getLastTab()
  return {
    type: 'library',
    tab: lastTab as 'files' | 'tags' | 'media' | 'uploads',
  }
}

export function navigate(path: string) {
  const tab = path.replace(/^#\/?/, '')
  if (VALID_TABS.has(tab)) {
    setLastTab(tab)
  }
  window.location.hash = path
}

function getSnapshot(): string {
  return window.location.hash
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getSnapshot)
  return useMemo(() => parseHash(hash), [hash])
}
