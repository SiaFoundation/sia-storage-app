import type { ImportSource } from '@siastorage/core/db/operations'
import { triggerImportScanner } from '../managers/importScanner'
import { showImportProgress } from '../stores/importProgress'
import {
  type Asset,
  importAssets,
  type ImportAssetsResult,
  type ImportFilesOptions,
} from './assetImports'

/**
 * Picker-flow entry point: stage the picks as import_files rows and kick the
 * scanner. Used by the document picker, photo picker, camera, and share-intent
 * consumer.
 *
 * Returns as soon as the rows are staged. The live progress modal then
 * watches the new import's summary (held hidden for a short reveal delay so quick imports
 * don't flash); the full per-file history lives on the Imports screen.
 */
export async function importFiles(
  assets: Asset[] | undefined,
  defaultFileName: string = 'file',
  options: ImportFilesOptions = {},
  source: ImportSource = 'picker',
): Promise<ImportAssetsResult> {
  const result = await importAssets(assets, defaultFileName, options, source)
  if (result.importId) {
    // Surface the live modal for this import, then drain promptly: a fresh
    // interactive import shouldn't wait the full scanner interval before its
    // first copy starts.
    showImportProgress(result.importId)
    triggerImportScanner()
  }
  return result
}
