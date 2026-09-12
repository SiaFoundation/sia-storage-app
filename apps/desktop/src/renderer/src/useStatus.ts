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
import type { DomainState, Materializing, Status } from './model'

type Shell = {
  domain: DomainState
  mountPath: string | null
  daemonReachable: boolean
  materializing: Materializing
}

/** While the shell is writing folders out there is no change signal to wait on. */
const PREPARING_POLL_MS = 2_000

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
    materializing: { active: false, done: 0, total: 0 },
  })

  const latest = useRef(0)

  const read = useCallback(async () => {
    // The interval and the change signal both call this, and the four reads
    // can settle out of order, so a stale answer must not overwrite a newer one.
    const ticket = ++latest.current
    // Settled independently: these are daemon calls, and one rejecting as the
    // daemon goes down would otherwise discard the reachability answer this
    // hook exists to publish.
    const [domain, mountPath, daemonReachable, materializing] = await Promise.allSettled([
      sia.shellStatus(),
      sia.mountPath(),
      sia.daemonReachable(),
      sia.materializing(),
    ])
    if (ticket !== latest.current) return false
    setShell((prev) => ({
      domain: domain.status === 'fulfilled' ? domain.value : prev.domain,
      mountPath: mountPath.status === 'fulfilled' ? mountPath.value : prev.mountPath,
      // A rejected reachability read is the bridge going down, not unknown.
      daemonReachable: daemonReachable.status === 'fulfilled' ? daemonReachable.value : false,
      materializing:
        materializing.status === 'fulfilled' ? materializing.value : prev.materializing,
    }))
    // Both need the poll: writing the library out raises no change signal,
    // and a mount transition comes from this process, so neither announces.
    return (
      (materializing.status === 'fulfilled' && materializing.value.active) ||
      (domain.status === 'fulfilled' && domain.value === 'starting')
    )
  }, [])

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // The newest tick owns the timer. Ticks overlap: a change signal starts
    // one while an earlier one is still awaiting its reads, and the earlier
    // completion clearing the timer would cancel the poll the newer one set.
    let generation = 0
    // A warm pass raises no signal when it starts, so a read landing just
    // before it begins would report idle and end the poll for good. Polling a
    // bounded number of times after mount and after each signal covers the
    // start window: the shell's four attempts span 15 seconds and the tracker
    // reports idle 8 seconds later, so 15 polls at 2 seconds outlasts both.
    const GRACE_POLLS = 15
    let graceLeft = GRACE_POLLS
    // Writing the library out raises no change signal, so while it is running
    // this is the only way to watch it move and to notice it finish.
    const tick = async () => {
      if (stopped) return
      const mine = ++generation
      const active = await read()
      if (stopped || mine !== generation) return
      clearTimeout(timer)
      if (!active && graceLeft > 0) graceLeft -= 1
      if (active || graceLeft > 0) timer = setTimeout(() => void tick(), PREPARING_POLL_MS)
    }
    void tick()
    const stop = sia.onChange((event) => {
      // Only a connection transition can precede a warm pass. A library event
      // during a long sync would otherwise keep the folder-count poll running
      // every two seconds for the sync's whole duration.
      if (event.scope === 'connection') graceLeft = GRACE_POLLS
      void tick()
    })
    return () => {
      stopped = true
      clearTimeout(timer)
      stop()
    }
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
    connectionError: connection.data?.connectionError ?? null,
    indexerUrl: indexer.data ?? '',
    domain: shell.domain,
    daemonReachable: shell.daemonReachable,
    mountPath: shell.mountPath,
    materializing: shell.materializing,
  }
}
