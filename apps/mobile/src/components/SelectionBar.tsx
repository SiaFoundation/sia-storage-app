import { logger } from '@siastorage/logger'
import {
  ArrowDownToLineIcon,
  CloudUploadIcon,
  FolderIcon,
  TagIcon,
  Trash2Icon,
} from 'lucide-react-native'
import { useCallback, useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import useSWR from 'swr'
import { trashFiles } from '../lib/deleteFile'
import { fetchBulkCounts, fileHasASealedObject } from '../lib/file'
import { useToast } from '../lib/toastContext'
import { downloadFile } from '../managers/downloader'
import { queueUploadForFileId } from '../managers/uploader'
import { useSelectedCount, useSelectedFileIds } from '../stores/fileSelection'
import { getFsFileUri } from '../stores/fs'
import { openSheet } from '../stores/sheets'
import { palette } from '../styles/colors'
import { BottomControlBar, iconColors } from './BottomControlBar'
import { BulkManageTagsSheet } from './BulkManageTagsSheet'
import { type OverflowAction, OverflowActions } from './OverflowActions'

type Props = {
  moveToDirectorySheet?: string
  onComplete?: () => void
}

export function SelectionBar({
  moveToDirectorySheet = 'moveToDirectory',
  onComplete,
}: Props) {
  const selectedCount = useSelectedCount()
  const selectedFileIds = useSelectedFileIds()
  const toast = useToast()

  const disabled = selectedCount === 0
  const ids = useMemo(() => Array.from(selectedFileIds), [selectedFileIds])

  const { data: counts } = useSWR(
    ids.length > 0 ? ['selectionCounts', ...ids] : null,
    () => fetchBulkCounts(ids),
  )

  const handleTag = useCallback(() => {
    openSheet('bulkManageTags')
  }, [])

  const handleMoveToFolder = useCallback(() => {
    openSheet(moveToDirectorySheet)
  }, [moveToDirectorySheet])

  const handleDownload = useCallback(async () => {
    if (!counts) return
    try {
      for (const file of counts.files) {
        const hasSealed = fileHasASealedObject(file)
        const uri = await getFsFileUri(file)
        if (hasSealed && !uri) {
          void downloadFile(file)
        }
      }
      if (counts.downloadable > 0) {
        toast.show(`Downloading ${counts.downloadable} files`)
      }
      onComplete?.()
    } catch (e) {
      logger.error('SelectionBar', 'download_failed', { error: e as Error })
      toast.show('Failed to start downloads')
    }
  }, [counts, onComplete, toast])

  const handleUpload = useCallback(async () => {
    if (!counts) return
    try {
      for (const file of counts.files) {
        const hasSealed = fileHasASealedObject(file)
        const uri = await getFsFileUri(file)
        if (uri && !hasSealed) {
          queueUploadForFileId(file.id)
        }
      }
      if (counts.uploadable > 0) {
        toast.show(`Queued ${counts.uploadable} uploads`)
      }
      onComplete?.()
    } catch (e) {
      logger.error('SelectionBar', 'upload_failed', { error: e as Error })
      toast.show('Failed to start uploads')
    }
  }, [counts, onComplete, toast])

  const handleTrash = useCallback(async () => {
    if (!counts) return
    try {
      await trashFiles(counts.files.map((f) => f.id))
      toast.show(`Moved ${counts.total} files to trash`)
      onComplete?.()
    } catch (e) {
      logger.error('SelectionBar', 'trash_failed', { error: e as Error })
      toast.show('Failed to move files to trash')
    }
  }, [counts, onComplete, toast])

  const actions: OverflowAction[] = useMemo(() => {
    const list: OverflowAction[] = [
      {
        key: 'tag',
        icon: <TagIcon color={iconColors.white} size={20} />,
        label: 'Add to tag',
        onPress: handleTag,
        disabled,
      },
      {
        key: 'folder',
        icon: <FolderIcon color={iconColors.white} size={20} />,
        label: 'Move to folder',
        onPress: handleMoveToFolder,
        disabled,
      },
    ]
    if (counts && counts.downloadable > 0) {
      list.push({
        key: 'download',
        icon: <ArrowDownToLineIcon color={iconColors.white} size={20} />,
        label: 'Download to device',
        onPress: handleDownload,
        disabled,
      })
    }
    if (counts && counts.uploadable > 0) {
      list.push({
        key: 'upload',
        icon: <CloudUploadIcon color={iconColors.white} size={20} />,
        label: 'Upload to network',
        onPress: handleUpload,
        disabled,
      })
    }
    list.push({
      key: 'trash',
      icon: <Trash2Icon color={palette.red[500]} size={20} />,
      label: 'Move to trash',
      onPress: handleTrash,
      variant: 'danger' as const,
      disabled,
    })
    return list
  }, [
    disabled,
    counts,
    handleTag,
    handleMoveToFolder,
    handleDownload,
    handleUpload,
    handleTrash,
  ])

  return (
    <>
      <BottomControlBar style={styles.bar}>
        <View style={styles.container}>
          <Text style={styles.count}>
            {selectedCount > 0 ? `${selectedCount} selected` : 'Select items'}
          </Text>
          <OverflowActions actions={actions} sheetName="selectionOverflow" />
        </View>
      </BottomControlBar>
      <BulkManageTagsSheet />
    </>
  )
}

const styles = StyleSheet.create({
  bar: {
    width: '90%',
    maxWidth: 600,
  },
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  count: {
    color: palette.gray[50],
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 8,
    fontVariant: ['tabular-nums'],
  },
})
