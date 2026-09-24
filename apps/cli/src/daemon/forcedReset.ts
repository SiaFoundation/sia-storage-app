/*
 * The daemon's side of the forced reset in core. It runs before the library
 * is opened and while the daemon holds its lock, so no other daemon has the
 * database or the cached files open.
 */
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import {
  type BuildVariant,
  RESET_KEEP_KEYS,
  recordForcedReset,
  resolveForcedReset,
} from '@siastorage/core/lib/forcedReset'
import { logger } from '@siastorage/logger'
import { createJsonFileStorage, ensureDataDir, type getPaths } from '@siastorage/node-adapters'

type Paths = ReturnType<typeof getPaths>

// deviceId names this install in its logs, and mobile keeps it through a reset
// too, so the logs from before and after one read as the same device.
const KEEP_KEYS = [...RESET_KEEP_KEYS, 'deviceId']

/**
 * Drops the database, the cached files and every stored setting except the
 * sign-in state. The account secrets are a separate file and stay, so the
 * daemon comes back signed in and syncs the library down again.
 */
export async function applyForcedReset(paths: Paths, variant: BuildVariant): Promise<void> {
  const storage = createJsonFileStorage(paths.storagePath)
  const action = await resolveForcedReset(storage, variant, existsSync(paths.dbPath))
  if (action === 'none') return
  if (action === 'reset') {
    logger.info('daemon', 'forced_reset', { variant })
    const kept: Record<string, string> = {}
    for (const key of KEEP_KEYS) {
      const value = await storage.getItem(key)
      if (value !== null) kept[key] = value
    }
    // Settings first and the database last. A crash anywhere in between leaves
    // the database in place and the nonce unrecorded, so the next start runs
    // the whole reset again. The other way round, a start after a crash finds
    // no database, records the nonce, and keeps a sync-down cursor pointing
    // past everything the dropped library held.
    const pruned = `${paths.storagePath}.reset`
    writeFileSync(pruned, JSON.stringify(kept, null, 2))
    renameSync(pruned, paths.storagePath)
    rmSync(paths.filesDir, { recursive: true, force: true })
    for (const file of [`${paths.dbPath}-wal`, `${paths.dbPath}-shm`, paths.dbPath]) {
      rmSync(file, { force: true })
    }
    ensureDataDir(paths.dataDir)
    await recordForcedReset(createJsonFileStorage(paths.storagePath), variant)
    return
  }
  await recordForcedReset(storage, variant)
}
