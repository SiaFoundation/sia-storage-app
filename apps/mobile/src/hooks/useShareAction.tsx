import Clipboard from '@react-native-clipboard/clipboard'
import { getErrorMessage } from '@siastorage/core/lib/errors'
import { extFromMime } from '@siastorage/core/lib/fileTypes'
import { useFileDetails, useSdk } from '@siastorage/core/stores'
import { logger } from '@siastorage/logger'
// oxlint-disable-next-line no-restricted-imports -- pickDirectoryAsync is async and createFile only creates an empty SAF document; the bytes are streamed natively by blob-util below
import { Directory, type File } from 'expo-file-system'
import { useCallback } from 'react'
import { Platform } from 'react-native'
import ReactNativeBlobUtil from 'react-native-blob-util'
import Share from 'react-native-share'
import { useFileStatus } from '../lib/file'
import { useToast } from '../lib/toastContext'
import { app } from '../stores/appService'

export function useShareAction({ fileId }: { fileId: string }) {
  const toast = useToast()
  const { data: file } = useFileDetails(fileId)
  const status = useFileStatus(file ?? undefined)
  const { data: isConnected } = useSdk()

  const getShareUrl = useCallback(async () => {
    if (!file) return
    if (!isConnected) return
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 1)
    return app().shares.create(file.id, expiresAt)
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
      const msg = getErrorMessage(e, '')
      if (!msg.includes('User did not share')) {
        logger.error('shareAction', 'share_failed', { error: e as Error })
      }
    }
  }, [file, status.data?.fileUri])

  // Android's system share sheet has no "Save to Files" target like iOS,
  // so we surface an explicit save action: the user picks a destination
  // folder in the system (SAF) picker and we stream the file into it.
  const handleSaveToDevice = useCallback(async () => {
    if (!file) return
    if (!file.type) return
    if (!status.data?.fileUri) return

    let directory: Directory
    try {
      directory = await Directory.pickDirectoryAsync()
    } catch (e) {
      if (getErrorMessage(e, '').includes('cancelled')) return
      logger.error('shareAction', 'save_to_device_pick_failed', { error: e as Error })
      toast.show('Failed to save file')
      return
    }

    let target: File | null = null
    try {
      // createFile makes an empty SAF document; blob-util then streams the
      // bytes into its content URI off the JS thread (expo-file-system's
      // own copy() is sync JSI and would block on large files).
      target = directory.createFile(file.name ?? `${file.id}${extFromMime(file.type)}`, file.type)
      await ReactNativeBlobUtil.MediaCollection.writeToMediafile(target.uri, status.data.fileUri)
      toast.show('File saved')
    } catch (e) {
      try {
        target?.delete()
      } catch {
        // Best effort — at worst an empty document is left behind.
      }
      logger.error('shareAction', 'save_to_device_failed', { error: e as Error })
      toast.show('Failed to save file')
    }
  }, [file, status.data?.fileUri, toast])

  return {
    canShare: status.data?.canShare,
    canSaveToDevice: Platform.OS === 'android' && !!status.data?.fileUri,
    handleShareURL,
    handleShareFile,
    handleSaveToDevice,
  }
}
