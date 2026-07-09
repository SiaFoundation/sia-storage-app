import { logger } from '@siastorage/logger'
import { useCallback, useRef } from 'react'
import { Platform } from 'react-native'
import type { Asset, ImportFilesOptions } from '../lib/assetImports'
import { capturePickedAssets } from '../lib/importCapture'
import { pickOriginalFiles } from '../lib/sourceRefs'
import { importFiles } from '../lib/importFiles'
import { showImportResultToast } from '../lib/importResultToast'
import { useToast } from '../lib/toastContext'

export function useDocumentPicker(options: ImportFilesOptions = {}) {
  const toast = useToast()
  const isPickingRef = useRef<boolean>(false)
  const { destinationDirectoryId, assignTagName } = options
  return useCallback(async (): Promise<void> => {
    if (isPickingRef.current) {
      logger.debug('documentPicker', 'already_picking')
      return
    }
    isPickingRef.current = true
    try {
      logger.debug('documentPicker', 'opening')
      // The module picker returns originals on both platforms; iOS picks
      // open in place with a bookmark minted in the delegate, Android picks
      // are grant-captured afterward.
      const openInPlace = Platform.OS === 'ios'
      const files = await pickOriginalFiles()
      if (files.length === 0) {
        logger.debug('documentPicker', 'canceled')
        return
      }
      const picked: Asset[] = files.map((f) => ({
        id: undefined,
        name: f.name,
        size: f.size,
        type: f.mimeType,
        timestamp: new Date(f.lastModified ?? Date.now()).toISOString(),
        sourceUri: f.uri,
        sourceRef: f.ref ?? null,
      }))

      const imported = await importFiles(
        await capturePickedAssets(picked, { openInPlace }),
        'file',
        { destinationDirectoryId, assignTagName },
        'picker',
      )
      showImportResultToast(toast, imported)
    } catch (e) {
      logger.error('documentPicker', 'error', { error: e as Error })
      toast.show('Could not add files. Please try again.')
    } finally {
      isPickingRef.current = false
    }
  }, [toast, destinationDirectoryId, assignTagName])
}
