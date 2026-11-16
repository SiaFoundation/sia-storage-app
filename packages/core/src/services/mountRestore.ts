/*
 * Bringing a file's bytes back from the mount when the cache has none to
 * upload from.
 *
 * An uploaded version the mount holds whole has no cache copy
 * (`localCopies.ts`). "Uploaded" means an object on the current indexer, so
 * changing the indexer leaves such a version needing an upload with its
 * bytes only in the mount, where the uploader never reads. This asks the
 * system to hand those bytes back. Each file it agrees to arrives as a
 * `provider.write` carrying a snapshot, which `write` recognises by its hash
 * and keeps as the version's cache copy.
 *
 * The system is told these files are not uploaded as soon as the indexer
 * changes, so it keeps its copies until they are.
 */
import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { minutesInMs } from '../lib/time'

/** Files asked for per run. */
const BATCH = 50
/** How long after asking for a file it is asked for again, when its bytes have not arrived. */
const ASK_AGAIN_AFTER = minutesInMs(10)
/** How long a file the system would not hand back waits. */
const FAILED_WAIT = minutesInMs(60)

/** When a file was last asked for, and when it may be asked for again. */
export type RestoreAsk = { askedAt: number; askAgainAt: number }

/**
 * Asks for up to `BATCH` files. `asked` maps a stack id to its last ask, and
 * the caller keeps it across runs. Files never asked for go first, then those
 * due again, the longest since their last ask first. The stranded query
 * orders by last use, so files that keep failing would otherwise be picked
 * again on every run ahead of the files behind them, which are never asked.
 *
 * An entry stays until its file is no longer stranded, which only a query
 * that returned fewer rows than its limit shows, since that one listed every
 * stranded file.
 */
export async function restoreFromMount(
  app: AppService,
  asked: Map<string, RestoreAsk>,
  signal?: AbortSignal,
): Promise<void> {
  const now = Date.now()
  const indexerURL = await app.settings.getIndexerURL()
  // At least `BATCH` rows past the ones already asked for, when there are that many.
  const limit = BATCH + asked.size
  const rows = await app.mountCopies.stranded(indexerURL, limit)
  if (rows.length < limit) {
    const stranded = new Set(rows.map((row) => row.stackId))
    for (const stackId of asked.keys()) if (!stranded.has(stackId)) asked.delete(stackId)
  }
  const never = rows.map((row) => row.stackId).filter((stackId) => !asked.has(stackId))
  const due = rows
    .map((row) => row.stackId)
    .filter((stackId) => (asked.get(stackId)?.askAgainAt ?? Infinity) <= now)
    .sort((a, b) => (asked.get(a)?.askedAt ?? 0) - (asked.get(b)?.askedAt ?? 0))
  const stackIds = [...never, ...due].slice(0, BATCH)
  if (stackIds.length === 0 || signal?.aborted) return

  let answers: Awaited<ReturnType<AppService['mount']['resend']>>
  try {
    answers = await app.mount.resend(stackIds, signal)
  } catch (e) {
    if (!signal?.aborted) logger.error('mountRestore', 'resend_failed', { error: e as Error })
    return
  }
  // No mount, or a host with no adapter.
  if (!answers) return

  const gone: string[] = []
  let agreed = 0
  for (const stackId of stackIds) {
    const answer = answers[stackId] ?? 'failed'
    if (answer === 'asked') agreed++
    if (answer === 'not-hydrated') {
      gone.push(stackId)
      asked.delete(stackId)
    } else {
      const wait = answer === 'asked' ? ASK_AGAIN_AFTER : FAILED_WAIT
      asked.set(stackId, { askedAt: now, askAgainAt: now + wait })
    }
  }
  // The system does not hold these whole after all, so the rows were wrong.
  await app.mountCopies.delete(gone, now)
  logger.info('mountRestore', 'asked', { agreed, gone: gone.length, of: stackIds.length })
}
