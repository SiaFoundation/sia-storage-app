import { logger } from '@siastorage/logger'
import { type PickedMedia, pickMedia } from 'import-sources'
import { useCallback, useRef } from 'react'
import { Platform } from 'react-native'
import type { Asset, ImportFilesOptions } from '../lib/assetImports'
import { importFiles, importPickedMedia } from '../lib/importFiles'
import { showImportResultToast } from '../lib/importResultToast'
import { useToast } from '../lib/toastContext'

function toAsset(p: PickedMedia): Asset {
  return {
    id: p.mediaAssetId,
    name: p.name,
    size: p.size,
    type: p.mimeType,
    timestamp: p.lastModified ? new Date(p.lastModified).toISOString() : undefined,
    sourceUri: p.uri,
  }
}

/**
 * Photo picks go through the module's pickMedia: Android's content uris
 * stage as one-shot file rows, iOS's PHAsset identifiers as media rows on
 * the same byte path as the photo-library sync, so a picked and a synced
 * photo can never hash differently. The pickers run out of process, so no
 * permission prompt is handled here; iOS ids outside a limited-access
 * selection stage as permission-denied rows.
 */
export function useImagePicker(options: ImportFilesOptions = {}) {
  const toast = useToast()
  const isPickingRef = useRef<boolean>(false)
  const { destinationDirectoryId, assignTagName } = options
  return useCallback(async (): Promise<void> => {
    if (isPickingRef.current) {
      logger.debug('imagePicker', 'already_picking')
      return
    }
    isPickingRef.current = true
    try {
      logger.debug('imagePicker', 'opening')
      const picks = await pickMedia()
      if (picks.length === 0) {
        logger.debug('imagePicker', 'canceled')
        return
      }
      const imported =
        Platform.OS === 'android'
          ? await importFiles(
              picks.map(toAsset),
              'file',
              { destinationDirectoryId, assignTagName },
              'picker',
            )
          : await importPickedMedia(
              picks.filter((p) => p.accessible !== false).map(toAsset),
              picks.filter((p) => p.accessible === false).map(toAsset),
              { destinationDirectoryId, assignTagName },
            )
      showImportResultToast(toast, imported)
    } catch (e) {
      logger.error('imagePicker', 'error', { error: e as Error })
      toast.show('Could not add photos. Please try again.')
    } finally {
      isPickingRef.current = false
    }
  }, [toast, destinationDirectoryId, assignTagName])
}
