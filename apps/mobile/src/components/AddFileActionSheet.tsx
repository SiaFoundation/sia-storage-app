import type { FileRecord } from '@siastorage/core/types'
import { CameraIcon, FileIcon, ImageIcon } from 'lucide-react-native'
import { useCallback } from 'react'
import { useCameraCapture } from '../hooks/useCameraCapture'
import { useDocumentPicker } from '../hooks/useDocumentPicker'
import { useImagePicker } from '../hooks/useImagePicker'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { ActionSheet } from './ActionSheet'
import { ActionSheetButton } from './ActionSheetButton'

type Props = {
  sheetName?: string
  /** Folder the picker was opened from. New files land here directly. */
  destinationDirectoryId?: string | null
  /** Tag to attach to every newly imported file. Used when opened from a tag's view. */
  assignTagName?: string
  onFilesAdded?: (files: FileRecord[]) => void
}

export function AddFileActionSheet({
  sheetName = 'addFile',
  destinationDirectoryId = null,
  assignTagName,
  onFilesAdded,
}: Props) {
  const isOpen = useSheetOpen(sheetName)
  const pickerOptions = { destinationDirectoryId, assignTagName }
  const pickImages = useImagePicker(pickerOptions)
  const capture = useCameraCapture(pickerOptions)
  const pickDocuments = useDocumentPicker(pickerOptions)

  const pickAndClose = useCallback(
    async (picker: () => Promise<FileRecord[]>) => {
      await closeSheet()
      const files = await picker()
      if (files.length > 0) {
        onFilesAdded?.(files)
      }
    },
    [onFilesAdded],
  )

  return (
    <ActionSheet visible={isOpen} onRequestClose={closeSheet}>
      <ActionSheetButton icon={<CameraIcon size={18} />} onPress={() => void pickAndClose(capture)}>
        Take Photo or Video
      </ActionSheetButton>
      <ActionSheetButton
        testID="action-choose-from-photos"
        icon={<ImageIcon size={18} />}
        onPress={() => void pickAndClose(pickImages)}
      >
        Choose from Photos
      </ActionSheetButton>
      <ActionSheetButton
        icon={<FileIcon size={18} />}
        onPress={() => void pickAndClose(pickDocuments)}
      >
        Import from Files
      </ActionSheetButton>
    </ActionSheet>
  )
}
