import useSWR from 'swr'
import { useApp } from '../app/context'

/** Aggregate counts of active, queued, and total downloads. */
export type DownloadCounts = {
  total: number
  totalActive: number
  totalQueued: number
}

/** Returns the current download counts broken down by status. */
export function useDownloadCounts() {
  const app = useApp()
  return useSWR(app.caches.downloads.key('counts'), () => {
    const { downloads } = app.downloads.getState()
    const counts: DownloadCounts = { total: 0, totalActive: 0, totalQueued: 0 }
    for (const rec of Object.values(downloads)) {
      if (rec.status === 'downloading') counts.totalActive += 1
      if (rec.status === 'queued') counts.totalQueued += 1
    }
    counts.total = counts.totalActive + counts.totalQueued
    return counts
  })
}

/** Fetches the download state for a single file by its ID. */
export function useDownloadEntry(id: string) {
  const app = useApp()
  return useSWR(app.caches.downloads.key(id), () => app.downloads.getEntry(id))
}
