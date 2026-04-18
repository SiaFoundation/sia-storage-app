import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useFileDetails, useIsFavorite } from '@siastorage/core/stores'
import { logger } from '@siastorage/logger'
import {
  ArrowDownToLineIcon,
  CloudUploadIcon,
  FolderIcon,
  HeartIcon,
  LinkIcon,
  ShareIcon,
  TagIcon,
  Trash2Icon,
} from 'lucide-react-native'
import { useCallback } from 'react'
import { StyleSheet, Text } from 'react-native'
import useSWR from 'swr'
import { useShareAction } from '../hooks/useShareAction'
import { fetchBulkCounts, fileHasASealedObject, useFileStatus } from '../lib/file'
import { useToast } from '../lib/toastContext'
import { downloadFile, useDownload } from '../managers/downloader'
import { queueUploadForFileId, useReuploadFile } from '../managers/uploader'
import type { MainStackParamList } from '../stacks/types'
import { app } from '../stores/appService'
import { closeSheet, openSheet, useSheetOpen } from '../stores/sheets'
import { palette } from '../styles/colors'
import { ActionSheet } from './ActionSheet'
import { ActionSheetButton } from './ActionSheetButton'

type Props = {
  sheetName?: string
  manageTagsSheet?: string
  moveToDirectorySheet?: string
  fileIds: string[]
  navigation?: NativeStackScreenProps<MainStackParamList, 'LibraryHome'>['navigation']
  onComplete?: () => void
}

export function FileActionsSheet({
  navigation,
  sheetName = 'fileActions',
  manageTagsSheet = 'manageFileTags',
  moveToDirectorySheet = 'moveToDirectory',
  fileIds,
  onComplete,
}: Props) {
  const isSingleFile = fileIds.length === 1
  const singleFileId = isSingleFile ? fileIds[0] : undefined

  return isSingleFile && singleFileId ? (
    <SingleFileActionsSheet
      sheetName={sheetName}
      manageTagsSheet={manageTagsSheet}
      moveToDirectorySheet={moveToDirectorySheet}
      fileId={singleFileId}
      navigation={navigation}
      onComplete={onComplete}
    />
  ) : (
    <BulkFileActionsSheet
      sheetName={sheetName}
      moveToDirectorySheet={moveToDirectorySheet}
      fileIds={fileIds}
      onComplete={onComplete}
    />
  )
}

type SingleFileProps = {
  sheetName: string
  manageTagsSheet: string
  moveToDirectorySheet: string
  fileId: string
  navigation?: Props['navigation']
  onComplete?: () => void
}

function SingleFileActionsSheet({
  navigation,
  sheetName,
  manageTagsSheet,
  moveToDirectorySheet,
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
  const favorite = useIsFavorite(isOpen ? fileId : null)

  const handleToggleFavorite = useCallback(async () => {
    const wasFavorite = favorite.data
    closeSheet(sheetName)
    await app().tags.toggleFavorite(fileId)
    toast.show(wasFavorite ? 'Removed from Favorites' : 'Added to Favorites')
  }, [fileId, sheetName, favorite.data, toast])

  const handlePressAndClose = useCallback(
    (action: () => void | Promise<void>) => () => {
      closeSheet(sheetName)
      void action()
    },
    [sheetName],
  )

  const reupload = useReuploadFile()
  const handleReupload = useCallback(async () => {
    if (!file) return
    try {
      await reupload(file.id)
      toast.show('Upload queued')
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'reupload_failed', { error: e as Error })
      toast.show('Failed to reupload file')
    }
    // oxlint-disable-next-line react/exhaustive-deps -- file.id is covered by file; both listed for clarity
  }, [file?.id, toast, onComplete, file, reupload])

  const handleDelete = useCallback(async () => {
    if (!file) return
    try {
      await app().files.trashFile(file.id)
      if (navigation) navigation.goBack()
      toast.show('Moved to trash')
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'delete_file_failed', {
        error: e as Error,
      })
      toast.show('Failed to move to trash')
    }
  }, [file, navigation, toast, onComplete])

  const handleDownload = useDownload(file, 0)

  return (
    <ActionSheet visible={isOpen} onRequestClose={() => closeSheet(sheetName)}>
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
      {!status.data?.isDownloaded && !status.data?.isDownloading && !status.data?.fileIsGone && (
        <ActionSheetButton
          variant="primary"
          icon={<ArrowDownToLineIcon size={18} />}
          onPress={handlePressAndClose(handleDownload)}
        >
          Download to device
        </ActionSheetButton>
      )}
      {!status.data?.isUploaded && !status.data?.isUploading && !status.data?.fileIsGone && (
        <ActionSheetButton
          variant="primary"
          icon={<CloudUploadIcon size={18} />}
          onPress={handlePressAndClose(handleReupload)}
        >
          Upload to network
        </ActionSheetButton>
      )}
      <ActionSheetButton
        variant="primary"
        icon={
          <HeartIcon
            size={18}
            fill={favorite.data ? palette.red[500] : 'none'}
            color={favorite.data ? palette.red[500] : undefined}
          />
        }
        onPress={handleToggleFavorite}
      >
        {favorite.data ? 'Remove from Favorites' : 'Add to Favorites'}
      </ActionSheetButton>
      <ActionSheetButton
        variant="primary"
        icon={<TagIcon size={18} />}
        onPress={() => {
          closeSheet(sheetName)
          setTimeout(() => openSheet(manageTagsSheet), 300)
        }}
      >
        Manage tags
      </ActionSheetButton>
      <ActionSheetButton
        variant="primary"
        icon={<FolderIcon size={18} />}
        onPress={() => {
          closeSheet(sheetName)
          setTimeout(() => openSheet(moveToDirectorySheet), 300)
        }}
      >
        Move to folder
      </ActionSheetButton>
      <ActionSheetButton
        variant="danger"
        icon={<Trash2Icon size={18} />}
        onPress={handlePressAndClose(handleDelete)}
      >
        Move to trash
      </ActionSheetButton>
    </ActionSheet>
  )
}

type BulkFileProps = {
  sheetName: string
  moveToDirectorySheet: string
  fileIds: string[]
  onComplete?: () => void
}

function BulkFileActionsSheet({
  sheetName,
  moveToDirectorySheet,
  fileIds,
  onComplete,
}: BulkFileProps) {
  const toast = useToast()
  const isOpen = useSheetOpen(sheetName)

  const { data: counts } = useSWR(isOpen ? ['bulkCounts', ...fileIds] : null, () =>
    fetchBulkCounts(fileIds),
  )

  const handlePressAndClose = useCallback(
    (action: () => void | Promise<void>) => () => {
      closeSheet(sheetName)
      void action()
    },
    [sheetName],
  )

  const handleDownloadToDevice = useCallback(async () => {
    if (!counts) return
    try {
      for (const file of counts.files) {
        const hasSealed = fileHasASealedObject(file)
        const uri = await app().fs.getFileUri(file)
        if (hasSealed && !uri) {
          void downloadFile(file, 0)
        }
      }
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'queue_downloads_failed', {
        error: e as Error,
      })
      toast.show('Failed to start downloads')
    }
  }, [counts, toast, onComplete])

  const handleUploadToNetwork = useCallback(async () => {
    if (!counts) return
    try {
      let queued = 0
      for (const file of counts.files) {
        const hasSealed = fileHasASealedObject(file)
        const uri = await app().fs.getFileUri(file)
        if (uri && !hasSealed) {
          queueUploadForFileId(file.id)
          queued++
        }
      }
      toast.show(`Queued ${queued} uploads`)
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'queue_uploads_failed', {
        error: e as Error,
      })
      toast.show('Failed to start uploads')
    }
  }, [counts, toast, onComplete])

  const handleDeleteAll = useCallback(async () => {
    if (!counts) return
    try {
      for (const f of counts.files) {
        await app().files.trashFile(f.id)
      }
      toast.show(`Moved ${counts.total.toLocaleString()} files to trash`)
      onComplete?.()
    } catch (e) {
      logger.error('FileActionsSheet', 'delete_files_failed', {
        error: e as Error,
      })
      toast.show('Failed to move files to trash')
    }
  }, [counts, toast, onComplete])

  const total = counts?.total ?? fileIds.length

  return (
    <ActionSheet visible={isOpen} onRequestClose={() => closeSheet(sheetName)}>
      <Text style={styles.bulkHeader}>{total.toLocaleString()} files selected</Text>
      <ActionSheetButton
        variant="primary"
        icon={<ArrowDownToLineIcon size={18} />}
        onPress={handlePressAndClose(handleDownloadToDevice)}
        disabled={!counts || counts.downloadable === 0}
      >
        Download to device{counts ? ` (${counts.downloadable.toLocaleString()})` : ''}
      </ActionSheetButton>
      <ActionSheetButton
        variant="primary"
        icon={<CloudUploadIcon size={18} />}
        onPress={handlePressAndClose(handleUploadToNetwork)}
        disabled={!counts || counts.uploadable === 0}
      >
        Upload to network{counts ? ` (${counts.uploadable.toLocaleString()})` : ''}
      </ActionSheetButton>
      <ActionSheetButton
        variant="primary"
        icon={<FolderIcon size={18} />}
        onPress={() => {
          closeSheet(sheetName)
          setTimeout(() => openSheet(moveToDirectorySheet), 300)
        }}
      >
        Move to folder
      </ActionSheetButton>
      <ActionSheetButton
        variant="danger"
        icon={<Trash2Icon size={18} />}
        onPress={handlePressAndClose(handleDeleteAll)}
        disabled={!counts}
      >
        Move {total.toLocaleString()} files to trash
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
