import { logger } from '@siastorage/logger'
import { removeStagedFile } from './importStaging'
import { SourceRefs } from './sourceRefs'
import { app } from '../stores/appService'

/**
 * Delete an import and clean up its resources: release every still-held OS
 * grant the delete returns (whatever the per-row release at copy success
 * missed, plus the folder tree grant) and remove any staged temp bytes the
 * rows still owned. Both are best-effort; the delete itself is already done.
 */
export async function deleteImportWithCleanup(importId: string): Promise<void> {
  let stagedUris: string[] = []
  try {
    const rows = await app().imports.files(importId)
    stagedUris = rows
      .filter((row) => row.sourceKind === 'staged' && row.sourceUri)
      .map((row) => row.sourceUri!)
  } catch (e) {
    logger.warn('importDelete', 'staged_scan_failed', { importId, error: e as Error })
  }

  const refs = await app().imports.delete(importId)

  for (const ref of refs) {
    await SourceRefs.releaseGrant(ref)
  }
  for (const uri of stagedUris) {
    await removeStagedFile(uri)
  }
}
