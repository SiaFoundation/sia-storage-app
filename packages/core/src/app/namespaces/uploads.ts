import type { AppCaches, AppService } from '../service'
import type { UploadsState } from '../stores'

/** Builds the uploads namespace: register, update, and clear in-progress uploads. */
export function buildUploadsNamespace(caches: AppCaches): AppService['uploads'] {
  let state: UploadsState = { uploads: {} }
  const debounced = caches.uploads.debounced(1000)

  const namespace: AppService['uploads'] = {
    getState: () => ({ ...state }),
    getEntry: (id) => state.uploads[id],
    register: (entry) => {
      state = { uploads: { ...state.uploads, [entry.id]: entry } }
      debounced.flush('all')
      debounced.flush('counts')
      caches.uploads.invalidate(entry.id)
    },
    update: (id, patch) => {
      const existing = state.uploads[id]
      if (!existing) return
      state = { uploads: { ...state.uploads, [id]: { ...existing, ...patch } } }
      debounced.invalidate('all')
      debounced.invalidate('counts')
      caches.uploads.invalidate(id)
    },
    remove: (id) => {
      const { [id]: _, ...rest } = state.uploads
      state = { uploads: rest }
      debounced.flush('all')
      debounced.flush('counts')
      caches.uploads.invalidate(id)
    },
    removeMany: (ids) => {
      const set = new Set(ids)
      state = {
        uploads: Object.fromEntries(Object.entries(state.uploads).filter(([k]) => !set.has(k))),
      }
      caches.uploads.invalidateAll()
    },
    clear: () => {
      state = { uploads: {} }
      caches.uploads.invalidateAll()
    },
    registerMany: (entries) => {
      const next = { ...state.uploads }
      for (const { id, size } of entries) {
        next[id] = { id, size, status: 'queued', progress: 0 }
      }
      state = { uploads: next }
      caches.uploads.invalidateAll()
    },
    setStatus: (id, status) => {
      if (!state.uploads[id]) return
      namespace.update(id, { status, error: undefined })
    },
    setError: (id, message) => {
      namespace.update(id, { status: 'error', error: message })
    },
    setBatchUploading: (ids, batchId) => {
      const next = { ...state.uploads }
      for (const id of ids) {
        const existing = next[id]
        if (!existing) continue
        next[id] = {
          ...existing,
          status: 'uploading',
          batchId,
          batchFileCount: ids.length,
        }
      }
      state = { uploads: next }
      caches.uploads.invalidateAll()
    },
    getActiveIds: () => {
      return Object.values(state.uploads)
        .filter(
          (u) =>
            u.status === 'queued' ||
            u.status === 'packing' ||
            u.status === 'packed' ||
            u.status === 'uploading',
        )
        .map((u) => u.id)
    },
  }

  return namespace
}
