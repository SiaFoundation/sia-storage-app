/*
 * The status the tray shows.
 *
 * The library half comes from the hooks in `@siastorage/core/stores`, refreshed
 * by the daemon's cache messages. The mount half cannot: a hook keeps serving
 * its last value once the daemon stops answering, so it is asked of the main
 * process over the bridge, on the change signal and on a poll while settling.
 */

import {
  useConnectionState,
  useFileCountAll,
  useFileStatsAll,
  useIndexerURL,
  useSyncState,
  useUploadCounts,
} from '@siastorage/core/stores'
import { useCallback, useEffect, useRef, useState } from 'react'
import { sia } from './api'
import type { DomainState, Status } from './model'

type Shell = {
  domain: DomainState
  mountPath: string | null
  daemonReachable: boolean
}

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

  const latest = useRef(0)

  const read = useCallback(async () => {
    // The interval and the change signal both call this, and the three reads
    // can settle out of order, so a stale answer must not overwrite a newer one.
    const ticket = ++latest.current
    try {
      const [domain, mountPath, daemonReachable] = await Promise.all([
        sia.shellStatus(),
        sia.mountPath(),
        sia.daemonReachable(),
      ])
      if (ticket !== latest.current) return
      setShell({ domain, mountPath, daemonReachable })
    } catch {
      // The bridge rejects while the main process tears down or the daemon
      // restarts. Holding the last state beats an unhandled rejection.
    }
  }, [])

  useEffect(() => {
    void read()
    const unsubscribe = sia.onChange(() => void read())
    // Mount transitions come from this process, so no change event announces
    // them and the popover would sit on "Mounting..." until something else moved.
    const settling = shell.domain === 'starting'
    const timer = settling ? setInterval(() => void read(), 1_000) : undefined
    return () => {
      unsubscribe()
      if (timer) clearInterval(timer)
    }
  }, [read, shell.domain])

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
    connectionError: connection.data?.connectionError ?? null,
    indexerUrl: indexer.data ?? '',
    domain: shell.domain,
    daemonReachable: shell.daemonReachable,
    mountPath: shell.mountPath,
  }
}
