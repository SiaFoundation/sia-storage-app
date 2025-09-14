import { useCallback } from 'react'
import { useFilePicker } from './useFilePicker'
import { useUploader } from '../managers/uploader'

export function usePickAndUpload() {
  const pickAssets = useFilePicker()
  const uploader = useUploader()
  return useCallback(async () => {
    const assets = await pickAssets()
    if (assets) {
      await uploader(assets)
    }
  }, [pickAssets, uploader])
}
