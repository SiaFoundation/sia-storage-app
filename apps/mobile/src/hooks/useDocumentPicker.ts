import { logger } from '@siastorage/logger'
import * as DocumentPicker from 'expo-document-picker'
import { useCallback, useRef } from 'react'
import { Platform } from 'react-native'
import type { Asset, ImportFilesOptions } from '../lib/assetImports'
import { capturePickedAssets } from '../lib/importCapture'
import { pickFilesOpenInPlace } from '../lib/sourceRefs'
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
      let picked: Asset[]
      let openInPlace = false
      if (Platform.OS === 'ios') {
        // Native open-in-place pick: the returned uris are the originals, so
        // no bytes are copied at pick time and bookmarks are created against
        // real files. (expo's picker hardcodes asCopy:true, which copies
        // every pick into purgeable tmp before JS runs.)
        openInPlace = true
        const files = await pickFilesOpenInPlace()
        if (files.length === 0) {
          logger.debug('documentPicker', 'canceled')
          return
        }
        picked = files.map((f) => ({
          id: undefined,
          name: f.name,
          size: f.size,
          type: f.mimeType,
          timestamp: new Date(f.lastModified ?? Date.now()).toISOString(),
          sourceUri: f.uri,
        }))
      } else {
        // Android: ACTION_OPEN_DOCUMENT yields grant-backed originals,
        // tagged under the grant budget.
        const result = await DocumentPicker.getDocumentAsync({
          multiple: true,
          type: '*/*',
          copyToCacheDirectory: false,
        })
        if (result.canceled) {
          logger.debug('documentPicker', 'canceled')
          return
        }
        picked = (result.assets ?? []).map((a) => ({
          id: undefined,
          name: a.name,
          size: a.size,
          type: a.mimeType,
          timestamp: new Date(a.lastModified ?? Date.now()).toISOString(),
          sourceUri: a.uri,
        }))
      }

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
