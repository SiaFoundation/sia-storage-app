import type { ImportSource } from '@siastorage/core/db/operations'
import { triggerImportScanner } from '../managers/importScanner'
import {
  type Asset,
  importAssets,
  type ImportAssetsResult,
  type ImportFilesOptions,
  importMediaAssets,
} from './assetImports'

/**
 * Picker-flow entry point: stage the picks as import_files rows and kick the
 * scanner. Used by the document picker, photo picker, camera, and share-intent
 * consumer.
 *
 * Returns as soon as the rows are staged; the destination view's import
 * banner is the progress surface, and the full per-file history lives on the
 * Imports screen.
 */
export async function importFiles(
  assets: Asset[] | undefined,
  defaultFileName: string = 'file',
  options: ImportFilesOptions = {},
  source: ImportSource = 'picker',
): Promise<ImportAssetsResult> {
  const result = await importAssets(assets, defaultFileName, options, source)
  afterStaged(result)
  return result
}

/**
 * iOS photo-pick entry point: stages media-kind rows (the scanner reads them
 * through the photo library) and kicks the scanner. `denied` picks become
 * terminal permission-denied rows in the same import.
 */
export async function importPickedMedia(
  assets: Asset[],
  denied: Asset[],
  options: ImportFilesOptions = {},
): Promise<ImportAssetsResult> {
  const result = await importMediaAssets(assets, denied, options)
  afterStaged(result)
  return result
}

// Drain promptly: a fresh interactive import shouldn't wait the full scanner
// interval before its first copy starts.
function afterStaged(result: ImportAssetsResult): void {
  if (!result.importId) return
  triggerImportScanner()
}
