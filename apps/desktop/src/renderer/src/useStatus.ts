/*
 * The status the tray and the window show.
 *
 * The library half comes from the hooks in `@siastorage/core/stores`, refreshed
 * by the daemon's cache messages. The mount half cannot: a hook keeps serving
 * its last value once the daemon stops answering, so it is asked of the main
 * process over the bridge, on the change signal and on a poll while settling.
 */

import { useApp } from '@siastorage/core/app'
import {
  useConnectionState,
  useFileCountAll,
  useFileStatsAll,
  useIndexerURL,
  useSyncState,
} from '@siastorage/core/stores'
import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { sia } from './api'
import {
  type DomainState,
  type Materializing,
  NO_UPLOADS,
  type Status,
  summarizeUploads,
  type Uploads,
} from './model'

type Shell = {
  domain: DomainState
  mountPath: string | null
  daemonReachable: boolean
  materializing: Materializing
  /** Whether a read has returned. Before one has, the fields above are placeholders. */
  known: boolean
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
    materializing: { active: false, done: 0, total: 0, passes: 0 },
    known: false,
  })

  const latest = useRef(0)
  const lastActive = useRef(false)

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
      known: true,
    }))
    // A transient rejection keeps the last known answer: reading it as idle
    // would stop the poll while the popover still shows the pass running. A
    // down daemon clears it, or an outage would keep this polling for good.
    if (materializing.status === 'fulfilled') lastActive.current = materializing.value.active
    else if (daemonReachable.status === 'fulfilled' && !daemonReachable.value) {
      lastActive.current = false
    }
    // Both need the poll: writing the library out raises no change signal,
    // and a mount transition comes from this process, so neither announces.
    return lastActive.current || (domain.status === 'fulfilled' && domain.value === 'starting')
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
    // start window: the shell retries the listing and the folder requests
    // four attempts each, five seconds apart, and the tracker reports idle
    // 8 seconds later, so the worst case is about 38 seconds and 20 polls
    // at 2 seconds outlasts it.
    const GRACE_POLLS = 20
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
      if (active || graceLeft > 0) {
        timer = setTimeout(() => void tick(), PREPARING_POLL_MS)
      }
    }
    void tick()
    const stop = sia.onChange((event) => {
      // Only a connection transition can change what this reads or precede a
      // warm pass, and a running pass is already polled. Library and sync
      // events arrive up to five times a second per scope during a long sync,
      // and each tick opens two daemon sockets.
      if (event.scope !== 'connection') return
      graceLeft = GRACE_POLLS
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

/**
 * The uploads the daemon is holding. `getState` is synchronous on the facade
 * and a promise across the bridge, so it is handed to SWR to await rather than
 * destructured here.
 */
function useUploads(): Uploads {
  const app = useApp()
  const { data } = useSWR(app.caches.uploads.key('active'), () => app.uploads.getState())
  return data ? summarizeUploads(Object.values(data.uploads)) : NO_UPLOADS
}

/**
 * Files on this Mac with no copy on the indexer yet. The uploader's own list
 * drops a file the moment it finishes, so "4 of 5" has to come from the
 * library, which keeps counting the one still to go.
 */
function useFilesNotUploaded(): number {
  const app = useApp()
  const { data } = useSWR(app.caches.library.key('notUploaded'), async () => {
    const indexerURL = await app.settings.getIndexerURL()
    return app.files.queryCount({
      order: 'ASC',
      pinned: { indexerURL, isPinned: false },
      fileExistsLocally: true,
    })
  })
  return data ?? 0
}

function useFolderCount(): number {
  const app = useApp()
  const { data } = useSWR(app.caches.directories.key('count'), () => app.directories.count())
  return data ?? 0
}

export function useStatus(): Status {
  const files = useFileCountAll()
  const folderCount = useFolderCount()
  const stats = useFileStatsAll()
  const indexer = useIndexerURL()
  const connection = useConnectionState()
  const sync = useSyncState()
  const uploads = useUploads()
  const filesNotUploaded = useFilesNotUploaded()
  const shell = useShell()

  return {
    fileCount: files.data ?? 0,
    filesNotUploaded,
    folderCount,
    libraryBytes: stats.data?.totalBytes ?? 0,
    uploads,
    syncingDown: sync.data?.isSyncingDown ?? false,
    syncDownProgress: sync.data?.syncDownProgress ?? 0,
    syncingUp: sync.data?.isSyncingUp ?? false,
    syncUpDone: sync.data?.syncUpProcessed ?? 0,
    syncUpTotal: sync.data?.syncUpTotal ?? 0,
    syncGate: sync.data?.syncGateStatus ?? 'unknown',
    connected: connection.data?.isConnected ?? false,
    connectionError: connection.data?.connectionError ?? null,
    indexerUrl: indexer.data ?? '',
    domain: shell.domain,
    daemonReachable: shell.daemonReachable,
    shellKnown: shell.known,
    mountPath: shell.mountPath,
    materializing: shell.materializing,
  }
}
