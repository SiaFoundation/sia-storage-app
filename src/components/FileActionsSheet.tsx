import { useCallback } from 'react'
import { Text, StyleSheet } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MainStackParamList } from '../stacks/types'
import {
  Trash2Icon,
  CloudOffIcon,
  EraserIcon,
  CloudUploadIcon,
  ShareIcon,
  LinkIcon,
} from 'lucide-react-native'
import useSWR from 'swr'
import { useToast } from '../lib/toastContext'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { removeFsFile, getFsFileUri } from '../stores/fs'
import { useDownload } from '../managers/downloader'
import { fileHasASealedObject, useFileStatus } from '../lib/file'
import { useReuploadFile, queueUploadForFileId } from '../managers/uploader'
import { ActionSheetButton } from './ActionSheetButton'
import { ActionSheet } from './ActionSheet'
import { FileRecord, readFileRecord, useFileDetails } from '../stores/files'
import { useSheetOpen, closeSheet } from '../stores/sheets'
import { useShareAction } from '../hooks/useShareAction'
import { logger } from '../lib/logger'
import {
  permanentlyDeleteFile,
  permanentlyDeleteFiles,
  deleteFileFromNetwork,
} from '../lib/deleteFile'
import { downloadFile } from '../managers/downloader'
import { palette } from '../styles/colors'

type Props = {
  sheetName?: string
  fileIds: string[]
  navigation?: NativeStackScreenProps<
    MainStackParamList,
    'LibraryHome'
  >['navigation']
  onComplete?: () => void
}

export function FileActionsSheet({
  navigation,
  sheetName = 'fileActions',
  fileIds,
  onComplete,
}: Props) {
  const isSingleFile = fileIds.length === 1
  const singleFileId = isSingleFile ? fileIds[0] : undefined

  return isSingleFile && singleFileId ? (
    <SingleFileActionsSheet
      sheetName={sheetName}
      fileId={singleFileId}
      navigation={navigation}
      onComplete={onComplete}
    />
  ) : (
    <BulkFileActionsSheet
      sheetName={sheetName}
      fileIds={fileIds}
      onComplete={onComplete}
    />
  )
}

type SingleFileProps = {
  sheetName: string
  fileId: string
  navigation?: Props['navigation']
  onComplete?: () => void
}

function SingleFileActionsSheet({
  navigation,
  sheetName,
  fileId,
  onComplete,
}: SingleFileProps) {
  const toast = useToast()
  const { data: file } = useFileDetails(fileId)
  const status = useFileStatus(file ?? undefined)
  const isOpen = useSheetOpen(sheetName)

  const { handleShareFile, handleShareURL, canShare } = useShareAction({
    fileId,
  })

  const handlePressAndClose = useCallback(
    (action: () => void | Promise<void>) => () => {
      closeSheet()
      void action()
    },
    []
  )

  const handleRemoveLocalFile = useCallback(async () => {
    if (!file) return
    try {
      await removeFsFile(file)
      toast.show('Removed from device')
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'failed to remove local file', e)
      toast.show('Failed to remove from device')
    }
  }, [file?.id, file?.type, toast, onComplete])

  const reupload = useReuploadFile()
  const handleReupload = useCallback(async () => {
    if (!file) return
    try {
      await reupload(file.id)
      toast.show('Upload queued')
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'failed to reupload file', e)
      toast.show('Failed to reupload file')
    }
  }, [file?.id, toast, onComplete])

  const handleRemoveFromNetwork = useCallback(async () => {
    if (!file) return
    try {
      await deleteFileFromNetwork(file)
      toast.show('Removed from network')
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'failed to remove from network', e)
      toast.show('Failed to remove from network')
    }
  }, [file?.id, toast, onComplete])

  const handleDelete = useCallback(async () => {
    if (!file) return
    try {
      await permanentlyDeleteFile(file)
      if (navigation) navigation.goBack()
      toast.show('File deleted')
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'failed to delete file', e)
      toast.show('Failed to delete file')
    }
  }, [file, navigation, toast, onComplete])

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
          onPress={handlePressAndClose(handleRemoveLocalFile)}
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

type BulkFileProps = {
  sheetName: string
  fileIds: string[]
  onComplete?: () => void
}

type BulkCounts = {
  onDevice: number
  onNetwork: number
  downloadable: number // on network but not on device
  uploadable: number // on device but not on network
  total: number
  files: FileRecord[]
}

async function fetchBulkCounts(fileIds: string[]): Promise<BulkCounts> {
  const files: FileRecord[] = []
  let onDevice = 0
  let onNetwork = 0
  let downloadable = 0
  let uploadable = 0

  for (const id of fileIds) {
    const file = await readFileRecord(id)
    if (file) {
      files.push(file)
      const hasSealed = fileHasASealedObject(file)
      const uri = await getFsFileUri(file)
      if (hasSealed) {
        onNetwork++
      }
      if (uri) {
        onDevice++
      }
      if (hasSealed && !uri) {
        downloadable++
      }
      if (uri && !hasSealed) {
        uploadable++
      }
    }
  }

  return {
    onDevice,
    onNetwork,
    downloadable,
    uploadable,
    total: files.length,
    files,
  }
}

function BulkFileActionsSheet({
  sheetName,
  fileIds,
  onComplete,
}: BulkFileProps) {
  const toast = useToast()
  const isOpen = useSheetOpen(sheetName)

  const { data: counts } = useSWR(
    isOpen ? ['bulkCounts', ...fileIds] : null,
    () => fetchBulkCounts(fileIds)
  )

  const handlePressAndClose = useCallback(
    (action: () => void | Promise<void>) => () => {
      closeSheet()
      void action()
    },
    []
  )

  const handleDownloadToDevice = useCallback(async () => {
    if (!counts) return
    try {
      let queued = 0
      for (const file of counts.files) {
        const hasSealed = fileHasASealedObject(file)
        const uri = await getFsFileUri(file)
        if (hasSealed && !uri) {
          // Fire and forget - don't await, just queue the download
          void downloadFile(file)
          queued++
        }
      }
      toast.show(`Queued ${queued} downloads`)
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'failed to queue downloads', e)
      toast.show('Failed to start downloads')
    }
  }, [counts, toast, onComplete])

  const handleRemoveFromDevice = useCallback(async () => {
    if (!counts) return
    try {
      let removed = 0
      for (const file of counts.files) {
        const uri = await getFsFileUri(file)
        if (uri) {
          await removeFsFile(file)
          removed++
        }
      }
      toast.show(`Removed ${removed} files from device`)
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'failed to remove files from device', e)
      toast.show('Failed to remove files from device')
    }
  }, [counts, toast, onComplete])

  const handleRemoveFromNetwork = useCallback(async () => {
    if (!counts) return
    try {
      let removed = 0
      for (const file of counts.files) {
        if (fileHasASealedObject(file)) {
          await deleteFileFromNetwork(file)
          removed++
        }
      }
      toast.show(`Removed ${removed} files from network`)
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'failed to remove files from network', e)
      toast.show('Failed to remove files from network')
    }
  }, [counts, toast, onComplete])

  const handleUploadToNetwork = useCallback(async () => {
    if (!counts) return
    try {
      let queued = 0
      for (const file of counts.files) {
        const hasSealed = fileHasASealedObject(file)
        const uri = await getFsFileUri(file)
        if (uri && !hasSealed) {
          queueUploadForFileId(file.id)
          queued++
        }
      }
      toast.show(`Queued ${queued} uploads`)
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'failed to queue uploads', e)
      toast.show('Failed to start uploads')
    }
  }, [counts, toast, onComplete])

  const handleDeleteAll = useCallback(async () => {
    if (!counts) return
    try {
      await permanentlyDeleteFiles(counts.files)
      toast.show(`Deleted ${counts.total} files`)
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'failed to delete files', e)
      toast.show('Failed to delete files')
    }
  }, [counts, toast, onComplete])

  const total = counts?.total ?? fileIds.length

  return (
    <ActionSheet visible={isOpen} onRequestClose={() => closeSheet()}>
      <Text style={styles.bulkHeader}>{total} files selected</Text>
      <ActionSheetButton
        variant="primary"
        icon={<ArrowDownToLineIcon size={18} />}
        onPress={handlePressAndClose(handleDownloadToDevice)}
        disabled={!counts || counts.downloadable === 0}
      >
        Download to device{counts ? ` (${counts.downloadable})` : ''}
      </ActionSheetButton>
      <ActionSheetButton
        variant="primary"
        icon={<CloudUploadIcon size={18} />}
        onPress={handlePressAndClose(handleUploadToNetwork)}
        disabled={!counts || counts.uploadable === 0}
      >
        Upload to network{counts ? ` (${counts.uploadable})` : ''}
      </ActionSheetButton>
      <ActionSheetButton
        variant="primary"
        icon={<EraserIcon size={18} />}
        onPress={handlePressAndClose(handleRemoveFromDevice)}
        disabled={!counts || counts.onDevice === 0}
      >
        Remove from device{counts ? ` (${counts.onDevice})` : ''}
      </ActionSheetButton>
      <ActionSheetButton
        variant="primary"
        icon={<CloudOffIcon size={18} />}
        onPress={handlePressAndClose(handleRemoveFromNetwork)}
        disabled={!counts || counts.onNetwork === 0}
      >
        Remove from network{counts ? ` (${counts.onNetwork})` : ''}
      </ActionSheetButton>
      <ActionSheetButton
        variant="danger"
        icon={<Trash2Icon size={18} />}
        onPress={handlePressAndClose(handleDeleteAll)}
        disabled={!counts}
      >
        Delete {total} files
      </ActionSheetButton>
    </ActionSheet>
  )
}

const styles = StyleSheet.create({
  bulkHeader: {
    color: palette.gray[50],
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    paddingBottom: 8,
  },
})
