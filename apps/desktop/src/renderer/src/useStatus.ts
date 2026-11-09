/*
 * The status the tray and the window show.
 *
 * The library half comes from the hooks in `@siastorage/core/stores`, refreshed
 * by the daemon's cache messages, and refreshed again when the daemon answers
 * after a stall, which sends none. The mount half cannot: a hook keeps serving
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
import { NO_UPLOADS, summarizeUploads, type Uploads } from '@siastorage/core/lib/uploadActivity'
import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { sia } from './api'
import type { DomainState, LocalCache, Materializing, Status } from './model'
import { refreshAfterStall, watchRecovery } from './recovery'

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
 *
 * `watch` keeps the poll running for as long as it is set. Setup needs that:
 * the extension starts writing folders out some seconds after the sync that
 * brought them, with no signal, and the bounded poll below has run out by the
 * time a long first sync ends.
 */
function useShell(watch: boolean): Shell {
  const app = useApp()
  const [shell, setShell] = useState<Shell>({
    domain: 'absent',
    mountPath: null,
    daemonReachable: false,
    materializing: { active: false, done: 0, total: 0, passes: 0 },
    known: false,
  })

  const latest = useRef(0)
  const lastActive = useRef(false)

  const read = useCallback(async (): Promise<{ active: boolean; reachable: boolean } | null> => {
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
    if (ticket !== latest.current) return null
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
    // down daemon clears it, since no pass runs without one.
    if (materializing.status === 'fulfilled') lastActive.current = materializing.value.active
    else if (daemonReachable.status === 'fulfilled' && !daemonReachable.value) {
      lastActive.current = false
    }
    // Both need the poll: writing the library out raises no change signal,
    // and a mount transition comes from this process, so neither announces.
    return {
      active: lastActive.current || (domain.status === 'fulfilled' && domain.value === 'starting'),
      reachable: daemonReachable.status === 'fulfilled' && daemonReachable.value,
    }
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
    const recovery = watchRecovery(() => refreshAfterStall(app.caches))
    // Writing the library out raises no change signal, so while it is running
    // this is the only way to watch it move and to notice it finish.
    const tick = async () => {
      if (stopped) return
      const mine = ++generation
      const result = await read()
      if (stopped || mine !== generation || !result) return
      const { active, reachable } = result
      clearTimeout(timer)
      recovery(reachable)
      // A daemon frozen or too busy to answer keeps its socket and the main
      // process's change stream open, so answering again sends no connection
      // signal. Without the poll the view would say Not running until the next
      // reconnect. The grace stays full meanwhile, so recovery gets what a
      // signal would.
      if (!reachable) graceLeft = GRACE_POLLS
      else if (!active && graceLeft > 0) graceLeft -= 1
      if (watch || active || graceLeft > 0) {
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
  }, [app, read, watch])

  return shell
}

/**
 * The uploads the daemon is holding. `getState` is synchronous on the facade
 * and a promise across the bridge, so it is handed to SWR to await rather than
 * destructured here.
 */
function useUploads(): { uploads: Uploads; storageFull: boolean } {
  const app = useApp()
  const { data } = useSWR(app.caches.uploads.key('active'), () => app.uploads.getState())
  return data
    ? { uploads: summarizeUploads(Object.values(data.uploads)), storageFull: data.storageFull }
    : { uploads: NO_UPLOADS, storageFull: false }
}

/**
 * Files on this Mac with no copy on the indexer yet, and their size. The
 * uploader's own list drops a file the moment it finishes, so "4 of 5" has to
 * come from the library, which keeps counting the one still to go.
 */
function useNotUploaded() {
  const app = useApp()
  return useSWR(app.caches.library.key('notUploaded'), async () => {
    const indexerURL = await app.settings.getIndexerURL()
    return app.files.queryStats({
      order: 'ASC',
      pinned: { indexerURL, isPinned: false },
      fileExistsLocally: true,
    })
  }).data
}

/**
 * Size of the local copies eviction keeps because they have no backup it
 * accepts. A trashed file or an older version that never uploaded counts,
 * though neither is waiting to upload.
 */
function useNotBackedUpBytes() {
  const app = useApp()
  return useSWR(app.caches.library.key('notBackedUp'), async () =>
    app.fs.calcNotBackedUpSize(await app.settings.getIndexerURL()),
  ).data
}

/**
 * Bytes in the daemon's cache, the cap it is held to, and the size of the
 * copies in it not backed up yet. Nothing invalidates a key when
 * a download lands, so the size also refreshes on a timer.
 */
export function useLocalCache(): LocalCache {
  const app = useApp()
  const bytes = useSWR(app.caches.library.key('localCacheBytes'), () => app.fs.calcTotalSize(), {
    refreshInterval: 30_000,
  })
  const maxBytes = useSWR(app.caches.settings.key('cacheMaxBytes'), () =>
    app.settings.getCacheMaxBytes(),
  )
  const notBackedUp = useNotBackedUpBytes()
  return {
    bytes: bytes.data ?? null,
    maxBytes: maxBytes.data,
    notUploadedBytes: notBackedUp ?? null,
  }
}

function useFolderCount(): number {
  const app = useApp()
  const { data } = useSWR(app.caches.directories.key('count'), () => app.directories.count())
  return data ?? 0
}

export function useStatus({ watch = false }: { watch?: boolean } = {}): Status {
  const files = useFileCountAll()
  const folderCount = useFolderCount()
  const stats = useFileStatsAll()
  const indexer = useIndexerURL()
  const connection = useConnectionState()
  const sync = useSyncState()
  const { uploads, storageFull } = useUploads()
  const filesNotUploaded = useNotUploaded()?.count ?? 0
  const shell = useShell(watch)

  return {
    fileCount: files.data ?? 0,
    filesNotUploaded,
    folderCount,
    libraryBytes: stats.data?.totalBytes ?? 0,
    uploads,
    storageFull,
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
