import useSWR from 'swr'
import { useApp } from '../app/context'
import type { UploadStatus } from '../app/stores'

const ACTIVE_STATUSES: UploadStatus[] = ['packing', 'packed', 'uploading']

/** Aggregate counts of active, queued, and total uploads. */
export type UploadCounts = {
  total: number
  totalActive: number
  totalQueued: number
}

/** Returns the current upload counts broken down by status. */
export function useUploadCounts() {
  const app = useApp()
  return useSWR(app.caches.uploads.key('counts'), () => {
    const { uploads } = app.uploads.getState()
    const counts: UploadCounts = { total: 0, totalActive: 0, totalQueued: 0 }
    for (const rec of Object.values(uploads)) {
      if (ACTIVE_STATUSES.includes(rec.status)) counts.totalActive += 1
      if (rec.status === 'queued') counts.totalQueued += 1
    }
    counts.total = counts.totalActive + counts.totalQueued
    return counts
  })
}

/** Fetches the upload state for a single file by its ID. */
export function useUploadEntry(id: string) {
  const app = useApp()
  return useSWR(app.caches.uploads.key(id), () => app.uploads.getEntry(id))
}
