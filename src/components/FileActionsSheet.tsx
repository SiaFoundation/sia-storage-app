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
import { useToast } from '../lib/toastContext'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { removeFileFromCache } from '../stores/fileCache'
import { useDownload } from '../managers/downloader'
import { useSdk } from '../stores/sdk'
import { useFileStatus } from '../lib/file'
import { useReuploadFile } from '../managers/uploader'
import { ActionSheetButton } from './ActionSheetButton'
import { ActionSheet } from './ActionSheet'
import { useFileDetails, deleteFileRecord } from '../stores/files'
import { deleteLocalObjects } from '../stores/localObjects'
import { useSheetOpen, closeSheet } from '../stores/sheets'
import { useShareAction } from '../hooks/useShareAction'
import { logger } from '../lib/logger'
import {
  deleteAllIndexerObjects,
  permanentlyDeleteFile,
  deleteFileFromNetwork,
} from '../lib/deleteFile'

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

  const { handleShareFile, handleShareURL, canShare } = useShareAction({
    fileId: route.params.id,
  })

  const handlePressAndClose = useCallback(
    (action: () => void | Promise<void>) => () => {
      closeSheet()
      void action()
    },
    []
  )

  const handleRemoveCache = useCallback(async () => {
    if (!file) return
    try {
      await removeFileFromCache(file)
      toast.show('Removed from cache')
    } catch (e) {
      logger.log('[FileActionsSheet] failed to remove cache', e)
      toast.show('Failed to remove cache')
    }
  }, [file?.id, file?.type, toast])

  const reupload = useReuploadFile()
  const handleReupload = useCallback(async () => {
    if (!file) return
    try {
      await reupload(file.id)
      toast.show('Reuploaded file')
    } catch (e) {
      logger.log('[FileActionsSheet] failed to reupload file', e)
      toast.show('Failed to reupload file')
    }
  }, [file?.id, toast])

  const handleRemoveFromNetwork = useCallback(async () => {
    if (!file) return
    try {
      await deleteFileFromNetwork(file)
      toast.show('Removed from network')
    } catch (e) {
      logger.log('[FileActionsSheet] failed to remove from network', e)
      toast.show('Failed to remove from network')
    }
  }, [file?.id, toast])

  const handleDelete = useCallback(async () => {
    if (!file) return
    try {
      await permanentlyDeleteFile(file)
      toast.show('File deleted')
    } catch (e) {
      logger.log('[FileActionsSheet] failed to delete file', e)
      toast.show('Failed to delete file')
    }
  }, [file])

  const handleDownload = useDownload(file)

  return (
    <ActionSheet visible={isOpen} onRequestClose={() => closeSheet()}>
      <ActionSheetButton
        disabled={!canShare}
        variant="primary"
        icon={<LinkIcon size={18} />}
        onPress={handlePressAndClose(handleShareURL)}
      >
        Share link
      </ActionSheetButton>
      <ActionSheetButton
        disabled={!canShare}
        variant="primary"
        icon={<ShareIcon size={18} />}
        onPress={handlePressAndClose(handleShareFile)}
      >
        Export file
      </ActionSheetButton>
      {!status.data?.isDownloaded &&
        !status.data?.isDownloading &&
        !status.data?.fileIsGone && (
          <ActionSheetButton
            variant="primary"
            icon={<ArrowDownToLineIcon size={18} />}
            onPress={handlePressAndClose(handleDownload)}
          >
            Download file
          </ActionSheetButton>
        )}
      {!status.data?.isUploaded &&
        !status.data?.isUploading &&
        !status.data?.fileIsGone && (
          <ActionSheetButton
            variant="primary"
            icon={<CloudUploadIcon size={18} />}
            onPress={handlePressAndClose(handleReupload)}
          >
            Upload file
          </ActionSheetButton>
        )}
      {status.data?.fileUri && status.data?.isUploaded && (
        <ActionSheetButton
          variant="primary"
          icon={<EraserIcon size={18} />}
          onPress={handlePressAndClose(handleRemoveCache)}
        >
          Remove from device
        </ActionSheetButton>
      )}
      {status.data?.isUploaded && (
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
