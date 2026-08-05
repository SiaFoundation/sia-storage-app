import type { UploaderAdapters } from '@siastorage/core/app'
import { deleteMediaAssets } from 'import-sources'
import { Platform } from 'react-native'
import { createFileReader } from '../lib/fileReader'
import { app } from '../stores/appService'

export function createUploaderAdapters(): UploaderAdapters {
  return {
    createFileReader: (uri) => createFileReader(uri),
    progressScheduler: (cb) => requestAnimationFrame(cb),
    onFilesUploaded: async (files) => {
      if (Platform.OS !== 'ios' || !(await app().settings.getDeletePhotosAfterUpload())) return
      const assetIds = files.flatMap((file) => (file.mediaAssetId ? [file.mediaAssetId] : []))
      if (assetIds.length > 0) await deleteMediaAssets([...new Set(assetIds)])
    },
  }
}
