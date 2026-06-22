import { PRUNE_SLABS_INTERVAL } from '@siastorage/core/config'
import { runPruneSlabs } from '@siastorage/core/services/pruneSlabs'
import { app, internal } from '../stores/appService'

/**
 * Prune unreferenced slabs on app start and foreground, at most once per
 * interval. The last-run time is persisted, so the throttle holds across app
 * restarts. No standalone timer — the app is never foregrounded long enough to
 * need one.
 */
export async function maybePruneSlabs(): Promise<void> {
  if (!app().connection.getState().isConnected) return
  const lastRun = await app().settings.getPruneSlabsLastRun()
  if (Date.now() - lastRun < PRUNE_SLABS_INTERVAL) return
  await app().settings.setPruneSlabsLastRun(Date.now())
  await runPruneSlabs(app(), internal())
}

/** Clears the throttle so the next start/foreground prunes again (sign-out/reset). */
export async function resetPruneThrottle(): Promise<void> {
  await app().settings.setPruneSlabsLastRun(0)
}
