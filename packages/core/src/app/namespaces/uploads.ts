import type { AppCaches, AppService } from '../service'
import type { UploadsState } from '../stores'

/** Builds the uploads namespace: register, update, and clear in-progress uploads. */
export function buildUploadsNamespace(
  caches: AppCaches,
): AppService['uploads'] {
  let state: UploadsState = { uploads: {} }

  const namespace: AppService['uploads'] = {
    getState: () => ({ ...state }),
    getEntry: (id) => state.uploads[id],
    register: (entry) => {
      state = { uploads: { ...state.uploads, [entry.id]: entry } }
      caches.uploads.invalidate('all')
      caches.uploads.invalidate('counts')
      caches.uploads.invalidate(entry.id)
    },
    update: (id, patch) => {
      const existing = state.uploads[id]
      if (!existing) return
      state = { uploads: { ...state.uploads, [id]: { ...existing, ...patch } } }
      caches.uploads.invalidate('all')
      caches.uploads.invalidate(id)
    },
    remove: (id) => {
      const { [id]: _, ...rest } = state.uploads
      state = { uploads: rest }
      caches.uploads.invalidate('all')
      caches.uploads.invalidate('counts')
      caches.uploads.invalidate(id)
    },
    removeMany: (ids) => {
      const set = new Set(ids)
      state = {
        uploads: Object.fromEntries(
          Object.entries(state.uploads).filter(([k]) => !set.has(k)),
        ),
      }
      caches.uploads.invalidateAll()
    },
    clear: () => {
      state = { uploads: {} }
      caches.uploads.invalidateAll()
    },
    registerMany: (entries) => {
      for (const { id, size } of entries) {
        namespace.register({ id, size, status: 'queued', progress: 0 })
      }
    },
    setStatus: (id, status) => {
      if (!state.uploads[id]) return
      namespace.update(id, { status, error: undefined })
    },
    setError: (id, message) => {
      namespace.update(id, { status: 'error', error: message })
    },
    setBatchUploading: (ids, batchId) => {
      for (const id of ids) {
        namespace.update(id, {
          status: 'uploading',
          batchId,
          batchFileCount: ids.length,
        })
      }
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
