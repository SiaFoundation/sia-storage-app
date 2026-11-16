/*
 * The step of cache eviction that frees the mount's copies, the ones the
 * operating system keeps in the folder a file manager shows. Only the system
 * can remove one, so it is asked to through the adapter.
 *
 * It runs after the pass has removed the cache copies, so a version whose
 * cache copy went this pass is a candidate here. The mount's candidates leave
 * out a version with a cache copy, since on macOS the two share disk blocks
 * and removing the mount's frees nothing while the cache copy stays.
 *
 * Every uploaded copy not used for `minAge` is asked about, oldest use first,
 * one page of candidates per call to the adapter.
 */
import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { MOUNT_DEHYDRATE_BATCH } from '../config'
import type { MountCandidate } from '../db/operations'

export type UnusedMountCopiesOptions = {
  /** Copies used more recently than this many ms ago stay. */
  minAge: number
  /** Candidate rows read per query. */
  batchSize: number
  /** Called for each copy the system removed. */
  evicted: (copy: { fileId: string; size: number }) => void
  signal?: AbortSignal
}

/** Asks the system to remove every unused mount copy, and resolves how many rows it read. */
export async function evictUnusedMountCopies(
  app: AppService,
  opts: UnusedMountCopiesOptions,
): Promise<number> {
  const { signal } = opts
  const pageSize = Math.min(opts.batchSize, MOUNT_DEHYDRATE_BATCH)
  // Fixed for the pass. A copy used after the pass began is then never read
  // as a candidate, and no file is asked about twice.
  const usedBefore = Date.now() - opts.minAge
  const indexerURL = await app.settings.getIndexerURL()
  let after: MountCandidate | null = null
  let rows = 0
  while (!signal?.aborted) {
    // Each page starts past the last row of the one before, since a copy the
    // system would not remove keeps its row and would otherwise come back.
    const page = await app.mountCopies.candidates(indexerURL, usedBefore, after, pageSize)
    if (page.length === 0) break
    after = page[page.length - 1]
    rows += page.length
    const removed = await dehydrate(app, page, indexerURL, signal)
    if (removed === null) break
    for (const copy of removed) opts.evicted(copy)
    if (page.length < pageSize) break
  }
  return rows
}

/**
 * Asks the system to remove its copies of `asked`, deletes the rows of those
 * it removed and returns those candidates. Null when the system could not be
 * asked, which ends the step until the next pass: on macOS the app is
 * mid-update or gone, the domain is not registered, or the call timed out.
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
