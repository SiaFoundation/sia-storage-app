import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import { acquireAutoKeepAwake, releaseAutoKeepAwake } from '../managers/autoKeepAwake'
import {
  beginImportProgress,
  failImportProgress,
  finishImportProgress,
  REVEAL_DELAY_MS,
  reportImportProgress,
  revealImportProgress,
} from '../stores/importProgress'
import { type Asset, importAssets, type ImportFilesOptions } from './assetImports'

const KEEP_AWAKE_KEY = 'import-progress'

/**
 * Public picker-flow API: insert placeholders, copy bytes, and drive the
 * import-progress modal end-to-end. Used by the document picker, photo
 * picker, camera, and share-intent consumer.
 *
 * If the user backgrounds the app mid-copy, the per-file copy parks at
 * app.fs.copyFile's waitUntilActive gate and resumes on foreground —
 * no cancellation, no abort signal.
 */
export async function importFiles(
  assets: Asset[] | undefined,
  defaultFileName: string = 'file',
  options: ImportFilesOptions = {},
): Promise<{ files: FileRecord[]; newVersionCount: number }> {
  const candidateAssets = (assets ?? []).filter((a) => !!a.sourceUri)
  if (candidateAssets.length === 0) {
    return { files: [], newVersionCount: 0 }
  }

  const totalFiles = candidateAssets.length
  const totalBytes = candidateAssets.reduce((s, a) => s + (a.size ?? 0), 0)

  beginImportProgress(totalFiles, totalBytes)
  const revealTimer = setTimeout(revealImportProgress, REVEAL_DELAY_MS)
  acquireAutoKeepAwake(KEEP_AWAKE_KEY)

  try {
    // Pass candidateAssets (already filtered) so the store totals seeded
    // above match exactly what importAssets stages.
    const result = await importAssets(candidateAssets, defaultFileName, {
      ...options,
      onCopyProgress: reportImportProgress,
    })
    const { copied, failed } = await result.copyPromise
    if (failed > 0) {
      logger.warn('importFiles', 'partial_failure', { copied, failed, total: totalFiles })
      const total = copied + failed
      failImportProgress(`${failed} of ${total} ${total === 1 ? 'file' : 'files'} failed to copy.`)
    } else {
      finishImportProgress()
    }
    return { files: result.files, newVersionCount: result.newVersionCount }
  } catch (e) {
    failImportProgress(e instanceof Error ? e.message : 'Import failed')
    throw e
  } finally {
    clearTimeout(revealTimer)
    releaseAutoKeepAwake(KEEP_AWAKE_KEY)
  }
}
