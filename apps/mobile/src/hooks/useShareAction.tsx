import Clipboard from '@react-native-clipboard/clipboard'
import { useFileDetails, useSdk } from '@siastorage/core/stores'
import { logger } from '@siastorage/logger'
import { useCallback } from 'react'
import Share from 'react-native-share'
import { getOneSealedObject, getPinnedObject, useFileStatus } from '../lib/file'
import { useToast } from '../lib/toastContext'
import { internal } from '../stores/appService'

export function useShareAction({ fileId }: { fileId: string }) {
  const toast = useToast()
  const { data: file } = useFileDetails(fileId)
  const status = useFileStatus(file ?? undefined)
  const { data: isConnected } = useSdk()

  const getShareUrl = useCallback(async () => {
    if (!file) return
    if (!isConnected) return
    const sdk = internal().getSdk()
    if (!sdk) return

    const result = getOneSealedObject(file)
    if (!result) return
    const pinnedObject = await getPinnedObject(
      result.indexerURL,
      result.sealedObject,
    )
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 1)
    return sdk.shareObject(pinnedObject, expiresAt)
  }, [file, isConnected])

  const handleShareURL = useCallback(async () => {
    if (!file) return
    if (!isConnected) return
    const shareUrl = await getShareUrl()
    if (!shareUrl) return
    Clipboard.setString(shareUrl)
    toast.show('Share URL copied')
  }, [file, isConnected, getShareUrl, toast])

  const handleShareFile = useCallback(async () => {
    if (!file) return
    if (!file.type) return
    if (!status.data?.fileUri) return

    try {
      await Share.open({
        url: status.data.fileUri,
        type: file.type,
        filename: file.name ?? undefined,
        subject: `Sia Storage - ${file.type}`,
      })
    } catch (e) {
      const msg =
        typeof e === 'string' ? e : e instanceof Error ? e.message : ''
      if (!msg.includes('User did not share')) {
        logger.error('shareAction', 'share_failed', { error: e as Error })
      }
    }
  }, [file, status.data?.fileUri])

  return {
    canShare: status.data?.isUploaded,
    handleShareURL,
    handleShareFile,
  }
}
