import Clipboard from '@react-native-clipboard/clipboard'
import { logger } from '@siastorage/logger'
import { useCallback } from 'react'
import Share from 'react-native-share'
import { getOneSealedObject, getPinnedObject, useFileStatus } from '../lib/file'
import { generateSiaShareUrl } from '../lib/shareUrl'
import { useToast } from '../lib/toastContext'
import { useFileDetails } from '../stores/files'
import { useSdk } from '../stores/sdk'

export function useShareAction({ fileId }: { fileId: string }) {
  const toast = useToast()
  const { data: file } = useFileDetails(fileId)
  const status = useFileStatus(file ?? undefined)
  const sdk = useSdk()

  const getShareUrl = useCallback(async () => {
    if (!file) return
    if (!sdk) return

    const result = getOneSealedObject(file)
    if (!result) return
    const pinnedObject = await getPinnedObject(
      result.indexerURL,
      result.sealedObject,
    )
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 1)
    return generateSiaShareUrl(sdk, pinnedObject, expiresAt)
  }, [file, sdk])

  const handleShareURL = useCallback(async () => {
    if (!file) return
    if (!sdk) return
    const shareUrl = await getShareUrl()
    if (!shareUrl) return
    Clipboard.setString(shareUrl)
    toast.show('Share URL copied')
  }, [file, sdk, getShareUrl, toast])

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
