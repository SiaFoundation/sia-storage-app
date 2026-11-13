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

/**
 * Asks for up to `BATCH` files. `askAgainAt` maps a stack id to when it may
 * next be asked for, and the caller keeps it across runs, so a batch of
 * files that keep failing does not hide the ones behind it.
 */
export async function restoreFromMount(
  app: AppService,
  askAgainAt: Map<string, number>,
  signal?: AbortSignal,
): Promise<void> {
  const now = Date.now()
  for (const [stackId, at] of askAgainAt) if (at <= now) askAgainAt.delete(stackId)

  const indexerURL = await app.settings.getIndexerURL()
  const rows = await app.mountCopies.stranded(indexerURL, BATCH + askAgainAt.size)
  const stackIds = rows
    .map((row) => row.stackId)
    .filter((stackId) => !askAgainAt.has(stackId))
    .slice(0, BATCH)
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
    if (answer === 'not-hydrated') gone.push(stackId)
    else askAgainAt.set(stackId, now + (answer === 'asked' ? ASK_AGAIN_AFTER : FAILED_WAIT))
  }
  // The system does not hold these whole after all, so the rows were wrong.
  await app.mountCopies.delete(gone, now)
  logger.info('mountRestore', 'asked', { agreed, gone: gone.length, of: stackIds.length })
}
