import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MainStackParamList } from '../stacks/types'
import { useCallback } from 'react'
import {
  Trash2Icon,
  CloudOffIcon,
  EraserIcon,
  CloudUploadIcon,
  ShareIcon,
  LinkIcon,
} from 'lucide-react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { removeFromCache } from '../stores/fileCache'
import { useDownload } from '../managers/downloader'
import { extFromMime } from '../lib/fileTypes'
import { useSdk } from '../stores/auth'
import { getOneSealedObject, getPinnedObject, useFileStatus } from '../lib/file'
import { useReuploadFile } from '../managers/uploader'
import { ActionSheetButton } from './ActionSheetButton'
import { ActionSheet } from './ActionSheet'
import {
  useFileDetails,
  deleteFileRecord,
  updateFileSealedObjects,
} from '../stores/files'
import Share from 'react-native-share'
import { useSheetOpen, closeSheet } from '../stores/sheets'
import { logger } from '../lib/logger'

type Props = NativeStackScreenProps<MainStackParamList, 'FileDetail'> & {
  sheetName?: string
}

export function FileActionsSheet({
  route,
  navigation,
  sheetName = 'fileActions',
}: Props) {
  const toast = useToast()
  const { data: file } = useFileDetails(route.params.id)
  const status = useFileStatus(file ?? undefined)
  const isOpen = useSheetOpen(sheetName)
  const sdk = useSdk()

  const getShareUrl = useCallback(async () => {
    if (!file) return
    if (!sdk) return

    const sealedObject = getOneSealedObject(file)
    if (!sealedObject) return
    const pinnedObject = await getPinnedObject(sealedObject)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 1)
    const shareUrl = sdk.shareObject(pinnedObject, expiresAt)
    return `siamobile://new-file?shareUrl=${encodeURIComponent(shareUrl)}`
  }, [file, sdk])

  const handleShareURL = useCallback(async () => {
    if (!file) return
    if (!sdk) return
    const shareUrl = await getShareUrl()
    if (!shareUrl) return
    Clipboard.setString(shareUrl)
    toast.show('URL Copied')
  }, [file, sdk, getShareUrl, toast])

  const handleShareFile = useCallback(async () => {
    if (!file) return
    if (!file.fileType) return
    if (!status.cachedUri) return

    try {
      await Share.open({
        url: status.cachedUri,
        type: file.fileType,
        filename: file.fileName ?? undefined,
        subject: `Sia Mobile - ${file.fileType}`,
      })
    } catch (e) {
      if (typeof e === 'string' && !e.includes('User did not share')) {
        logger.log('File sharing failed:', e)
      }
    }
  }, [file, status.cachedUri])

  const handlePressAndClose = useCallback(
    (action: () => void | Promise<void>) => () => {
      closeSheet()
      void action()
    },
    []
  )

  const handleDelete = useCallback(async () => {
    if (!file) return
    try {
      await deleteFileRecord(file.id)
      toast.show('Deleted file')
      closeSheet()
      navigation.goBack()
    } catch (e) {
      toast.show('Failed to delete file')
      closeSheet()
    }
  }, [file?.id, navigation, toast])

  const handleRemoveCache = useCallback(async () => {
    if (!file) return
    try {
      await removeFromCache(file.id, extFromMime(file.fileType))
      toast.show('Removed from cache')
      closeSheet()
    } catch (e) {
      toast.show('Failed to remove cache')
      closeSheet()
    }
  }, [file?.id, file?.fileType, toast])

  const reupload = useReuploadFile()
  const handleReupload = useCallback(async () => {
    if (!file) return
    try {
      await reupload(file.id)
      toast.show('Reuploaded file')
      closeSheet()
    } catch (e) {
      toast.show('Failed to reupload file')
      closeSheet()
    }
  }, [file?.id, toast])

  const handleRemoveFromNetwork = useCallback(async () => {
    if (!file) return
    try {
      for (const sealedObject of Object.values(file.sealedObjects ?? {})) {
        sdk?.deleteObject(sealedObject.id)
      }
      await updateFileSealedObjects(file.id, {})
      toast.show('Removed from network')
      closeSheet()
    } catch (e) {
      toast.show('Failed to remove from network')
      closeSheet()
    }
  }, [file?.id, toast])

  const handleDownload = useDownload(file)

  return (
    <ActionSheet visible={isOpen} onRequestClose={() => closeSheet()}>
      <ActionSheetButton
        disabled={!status.isUploaded}
        variant="primary"
        icon={<LinkIcon size={18} />}
        onPress={handlePressAndClose(handleShareURL)}
      >
        Share link
      </ActionSheetButton>
      <ActionSheetButton
        disabled={!status.isUploaded}
        variant="primary"
        icon={<ShareIcon size={18} />}
        onPress={handleShareFile}
      >
        Export file
      </ActionSheetButton>
      {!status.isDownloaded && !status.isDownloading && !status.fileIsGone && (
        <ActionSheetButton
          variant="primary"
          icon={<ArrowDownToLineIcon size={18} />}
          onPress={handlePressAndClose(handleDownload)}
        >
          Download file
        </ActionSheetButton>
      )}
      {!status.isUploaded && !status.isUploading && !status.fileIsGone && (
        <ActionSheetButton
          variant="primary"
          icon={<CloudUploadIcon size={18} />}
          onPress={handlePressAndClose(handleReupload)}
        >
          Upload file
        </ActionSheetButton>
      )}
      {status.cachedUri && status.isUploaded && (
        <ActionSheetButton
          variant="primary"
          icon={<EraserIcon size={18} />}
          onPress={handlePressAndClose(handleRemoveCache)}
        >
          Remove from device
        </ActionSheetButton>
      )}
      {status.isUploaded && (
        <ActionSheetButton
          variant="primary"
          icon={<CloudOffIcon size={18} />}
          onPress={handlePressAndClose(handleRemoveFromNetwork)}
        >
          Remove from network
        </ActionSheetButton>
      )}
      <ActionSheetButton
        variant="danger"
        icon={<Trash2Icon size={18} />}
        onPress={handlePressAndClose(handleDelete)}
      >
        Delete file
      </ActionSheetButton>
    </ActionSheet>
  )
}
