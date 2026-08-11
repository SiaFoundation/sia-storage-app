/*
 * The status the tray shows.
 *
 * The library half comes from the hooks in `@siastorage/core/stores`, the same
 * ones the mobile app renders from. They refresh themselves. The daemon names
 * each cache change as it makes it, those messages are replayed into this
 * window's caches, and the hooks bound to them re-read or take the value that
 * came with it. Nothing here polls.
 *
 * The mount half cannot come from there. A Finder domain is not library state,
 * and neither is whether the daemon is answering: a hook keeps serving its last
 * value once the daemon stops. Both are asked of the main process over the
 * bridge and re-read on the change signal.
 */

import {
  useConnectionState,
  useFileCountAll,
  useFileStatsAll,
  useIndexerURL,
  useSyncState,
  useUploadCounts,
} from '@siastorage/core/stores'
import { useCallback, useEffect, useState } from 'react'
import { sia } from './api'

export type DomainState = 'absent' | 'starting' | 'mounted' | 'error'

export type Status = {
  fileCount: number
  libraryBytes: number
  /** Files the current sync-up run has finished, out of `uploadsTotal`. */
  uploadsDone: number
  uploadsTotal: number
  uploadsPending: number
  syncingDown: boolean
  /** 0..1. Sync-down reports a fraction rather than a count, so it has no total. */
  downloadProgress: number
  connected: boolean
  indexerUrl: string
  domain: DomainState
  daemonReachable: boolean
  mountPath: string | null
}

type Shell = { domain: DomainState; mountPath: string | null; daemonReachable: boolean }

/**
 * The mount and the daemon behind it. Neither is library state, and neither can
 * be inferred from a library read: a hook keeps answering from its cache after
 * the daemon stops answering, so this asks.
 */
function useShell(): Shell {
  const [shell, setShell] = useState<Shell>({
    domain: 'absent',
    mountPath: null,
    daemonReachable: false,
  })

  const read = useCallback(async () => {
    const [domain, mountPath, daemonReachable] = await Promise.all([
      sia.shellStatus(),
      sia.mountPath(),
      sia.daemonReachable(),
    ])
    setShell({ domain, mountPath, daemonReachable })
  }, [])

  useEffect(() => {
    void read()
    return sia.onChange(() => void read())
  }, [read])

  return shell
}

export function useStatus(): Status {
  const files = useFileCountAll()
  const stats = useFileStatsAll()
  const indexer = useIndexerURL()
  const connection = useConnectionState()
  const sync = useSyncState()
  const uploads = useUploadCounts()
  const shell = useShell()

  return {
    fileCount: files.data ?? 0,
    libraryBytes: stats.data?.totalBytes ?? 0,
    uploadsDone: sync.data?.syncUpProcessed ?? 0,
    uploadsTotal: sync.data?.syncUpTotal ?? 0,
    uploadsPending: uploads.data?.total ?? 0,
    syncingDown: sync.data?.isSyncingDown ?? false,
    downloadProgress: sync.data?.syncDownProgress ?? 0,
    connected: connection.data?.isConnected ?? false,
    indexerUrl: indexer.data ?? '',
    domain: shell.domain,
    daemonReachable: shell.daemonReachable,
    mountPath: shell.mountPath,
  }
}

export const transferInFlight = (s: Status): boolean =>
  s.syncingDown || (s.uploadsTotal > 0 && s.uploadsDone < s.uploadsTotal)

export const transferLabel = (s: Status): string => (s.syncingDown ? 'Downloading' : 'Uploading')

/** Empty while downloading: sync-down knows its progress but not how many objects. */
export const transferCount = (s: Status): string =>
  !s.syncingDown && s.uploadsTotal > 0 ? `${s.uploadsDone} of ${s.uploadsTotal}` : ''

export const transferProgress = (s: Status): number => {
  if (s.syncingDown) return s.downloadProgress
  return s.uploadsTotal > 0 ? s.uploadsDone / s.uploadsTotal : 0
}

export const fileCountLabel = (s: Status): string => s.fileCount.toLocaleString()

export const librarySizeLabel = (s: Status): string =>
  s.libraryBytes > 0 ? formatBytes(s.libraryBytes) : '-'

export const indexerLabel = (s: Status): string => s.indexerUrl.replace(/^https?:\/\//, '')

export function mountLabel(s: Status): string {
  switch (s.domain) {
    case 'mounted':
      return 'Mounted'
    case 'starting':
      return 'Mounting…'
    case 'error':
      return 'Unavailable'
    default:
      return 'Not mounted'
  }
}

/** Accent means in flight, which the dot animates on, so a steady state stays quiet. */
export function indicator(s: Status): 'red' | 'orange' | 'green' | 'accent' {
  if (!s.daemonReachable) return 'red'
  if (s.domain === 'error') return 'red'
  // Transfer before connection, matching `activity`, or a transfer running while
  // the indexer is unreachable shows a stalled dot over an active headline.
  if (transferInFlight(s)) return 'accent'
  if (!s.connected) return 'orange'
  return 'green'
}

export function activity(s: Status): string {
  if (!s.daemonReachable) return 'Not running'
  if (transferInFlight(s)) return transferLabel(s)
  if (!s.connected) return 'Connecting'
  return 'Up to date'
}

export function activityDetail(s: Status): string | null {
  if (!s.daemonReachable) return 'Open logs for the reason'
  if (s.domain === 'error') return 'The Finder mount is unavailable'
  if (!s.connected) return 'Waiting to reach the indexer'
  return null
}

/** Powers of 1000, which is what Finder counts in. */
function formatBytes(bytes: number): string {
  const units = ['kB', 'MB', 'GB', 'TB']
  if (bytes < 1000) return `${bytes} bytes`
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
