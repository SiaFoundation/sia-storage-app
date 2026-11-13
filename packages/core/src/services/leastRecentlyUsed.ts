/*
 * The least-recently-used step of cache eviction.
 *
 * A device has up to two stores to free space from. A cache copy is this
 * app's own file and is deleted. A mount copy is the operating system's, in
 * the folder a file manager shows, and only the system can remove it, so it
 * is asked to through the adapter. No file is counted in both: a version the
 * mount holds whole has no cache copy once it is uploaded (`localCopies.ts`).
 *
 * Copies are taken oldest first across both stores until the device is back
 * under its limit. A cache copy goes at once. Mount copies next to each
 * other in that order are gathered into one call to the adapter, sized to
 * what is still over the limit, and the call's answers are applied before
 * anything newer is taken, so the system is never asked to remove more than
 * the limit needs and no newer copy goes in place of an older one.
 */
import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { MOUNT_DEHYDRATE_BATCH } from '../config'
import type { EvictionRow, MountCandidate } from '../db/operations'

export type LeastRecentlyUsedOptions = {
  /** Bytes the device is over its limit by. */
  over: number
  /** Copies used more recently than this many ms ago stay. */
  minAge: number
  /** Candidate rows read per query. */
  batchSize: number
  /**
   * Keeps a cache copy of these types until its thumbnails are made or it was
   * added before `addedBefore`. The scanner makes them from the cache copy
   * only, so a mount copy never waits.
   */
  thumbnails?: { types: readonly string[]; addedBefore: number }
  /** Whether the library has a mount to free copies from. */
  mount: boolean
  /** Deletes one cache copy, resolving whether it went. */
  removeCacheCopy: (row: EvictionRow) => Promise<boolean>
  /** Called for each copy removed. */
  evicted: (copy: { fileId: string; size: number }, store: 'cache' | 'mount') => void
  signal?: AbortSignal
}

/** Frees copies until `over` bytes are gone or none are left, and resolves how many rows it took. */
export async function evictLeastRecentlyUsed(
  app: AppService,
  opts: LeastRecentlyUsedOptions,
): Promise<number> {
  const { batchSize, signal } = opts
  // Both fixed for the pass. A copy used after the pass began is then never
  // read as a candidate, and no file is asked about twice.
  const usedBefore = Date.now() - opts.minAge
  const indexerURL = await app.settings.getIndexerURL()
  const cache = pager<EvictionRow>(
    (after) => app.fs.evictionCandidates(indexerURL, usedBefore, after, batchSize, opts.thumbnails),
    batchSize,
  )
  const mount = pager<MountCandidate>(
    async (after) =>
      opts.mount ? app.mountCopies.candidates(indexerURL, usedBefore, after, batchSize) : [],
    batchSize,
  )

  let over = opts.over
  let rows = 0
  let pending: MountCandidate[] = []
  let pendingBytes = 0

  /** Asks the system to remove the mount copies gathered so far. False ends the pass. */
  async function flush(): Promise<boolean> {
    const asked = pending
    pending = []
    pendingBytes = 0
    if (asked.length === 0) return true
    const removed = await dehydrate(app, asked, indexerURL, signal)
    for (const copy of removed ?? []) {
      opts.evicted(copy, 'mount')
      over -= copy.size
    }
    return removed !== null
  }

  while (!signal?.aborted && over > 0) {
    const [cached, mounted] = await Promise.all([cache.peek(), mount.peek()])
    const cacheNext = cached !== undefined && (!mounted || cached.usedAt <= mounted.usedAt)
    // The system is asked once the mount copies gathered would cover what is
    // left, and before a cache copy newer than them is deleted.
    const full = pendingBytes >= over || pending.length >= MOUNT_DEHYDRATE_BATCH
    if (pending.length > 0 && (full || cacheNext)) {
      if (!(await flush())) return rows
      continue
    }
    if (cached && cacheNext) {
      cache.take()
      rows++
      if (await opts.removeCacheCopy(cached)) {
        opts.evicted(cached, 'cache')
        over -= cached.size
      }
    } else if (mounted) {
      mount.take()
      rows++
      pending.push(mounted)
      pendingBytes += mounted.size
    } else {
      break
    }
  }
  if (!signal?.aborted && over > 0) await flush()
  return rows
}

/**
 * Asks the system to remove its copies of `asked`, deletes the rows of those
 * it removed and returns those candidates. Null when the system could not be asked, which
 * ends the pass rather than freeing newer cache copies in their place: on
 * macOS the app is mid-update or gone, the domain is not registered, or the
 * call timed out.
 */
async function dehydrate(
  app: AppService,
  asked: MountCandidate[],
  indexerURL: string,
  signal?: AbortSignal,
): Promise<MountCandidate[] | null> {
  // The candidates were read as uploaded to `indexerURL`. After a switch,
  // the mount's copy of a file may be the only one an upload to the new
  // indexer can be made from.
  if ((await app.settings.getIndexerURL()) !== indexerURL) return null
  const stackIds = asked.map((copy) => copy.stackId)
  const callStart = Date.now()
  let answers: Awaited<ReturnType<AppService['mount']['dehydrate']>>
  try {
    answers = await app.mount.dehydrate(stackIds, signal)
  } catch (e) {
    // A shutdown aborting the call is not a failure.
    if (!signal?.aborted) {
      logger.error('cacheEviction', 'mount_dehydrate_failed', { error: e as Error })
    }
    return null
  }
  // The mount was cleared since the pass read it, or this host has no adapter.
  if (!answers) return null

  // Every candidate is uploaded, so a refusal means the system's record of
  // the file is stale, or the user pinned it. Either way it is asked about
  // again on the next pass, as a file open in an app is.
  const refused = stackIds.filter((stackId) => answers[stackId] === 'refused').length
  if (refused > 0) {
    logger.warn('cacheEviction', 'mount_dehydrate_refused', { refused, asked: stackIds.length })
  }
  const done = asked.filter((copy) => answers[copy.stackId] === 'done')
  // A row used after the call started is a file the system read again while
  // the call ran, so it holds those bytes once more and its row stays. A use
  // in the same millisecond as the start is taken as before it, which is
  // where a candidate read just before the pass sits.
  const deleted = await app.mountCopies.delete(
    done.map((copy) => copy.stackId),
    callStart + 1,
  )
  return done.filter((copy) => deleted.some((row) => row.stackId === copy.stackId))
}

/**
 * Reads one store's candidates a page at a time. Each page starts past the
 * last row of the one before rather than from the oldest row again, since a
 * copy that could not be removed leaves its row in place and would otherwise
 * come back on every page.
 */
function pager<Row>(
  read: (after: Row | null) => Promise<Row[]>,
  pageSize: number,
): { peek(): Promise<Row | undefined>; take(): void } {
  let page: Row[] = []
  let last: Row | null = null
  let exhausted = false
  return {
    async peek() {
      if (page.length === 0 && !exhausted) {
        page = await read(last)
        if (page.length < pageSize) exhausted = true
        if (page.length > 0) last = page[page.length - 1]
      }
      return page[0]
    },
    take() {
      page.shift()
    },
  }
}
