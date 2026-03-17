import type { FileRecord } from '@siastorage/core/types'
import { CameraIcon, FileIcon, ImageIcon } from 'lucide-react-native'
import { useCallback } from 'react'
import { useCameraCapture } from '../hooks/useCameraCapture'
import { useDocumentPicker } from '../hooks/useDocumentPicker'
import { useImagePicker } from '../hooks/useImagePicker'
import { useUploader } from '../managers/uploader'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { ActionSheet } from './ActionSheet'
import { ActionSheetButton } from './ActionSheetButton'

type Props = {
  sheetName?: string
  onFilesAdded?: (files: FileRecord[]) => void
}

export function AddFileActionSheet({
  sheetName = 'addFile',
  onFilesAdded,
}: Props) {
  const isOpen = useSheetOpen(sheetName)
  const pickImages = useImagePicker()
  const capture = useCameraCapture()
  const pickDocuments = useDocumentPicker()
  const uploader = useUploader()

  const pickAndUpload = useCallback(
    async (picker: () => Promise<FileRecord[]>) => {
      await closeSheet()
      const files = await picker()
      if (files.length > 0) {
        onFilesAdded?.(files)
        await uploader(files)
      }
    },
    [onFilesAdded, uploader],
  )

  return (
    <ActionSheet visible={isOpen} onRequestClose={closeSheet}>
      <ActionSheetButton
        icon={<CameraIcon size={18} />}
        onPress={() => void pickAndUpload(capture)}
      >
        Take Photo or Video
      </ActionSheetButton>
      <ActionSheetButton
        testID="action-choose-from-photos"
        icon={<ImageIcon size={18} />}
        onPress={() => void pickAndUpload(pickImages)}
      >
        Choose from Photos
      </ActionSheetButton>
      <ActionSheetButton
        icon={<FileIcon size={18} />}
        onPress={() => void pickAndUpload(pickDocuments)}
      >
        Import from Files
      </ActionSheetButton>
    </ActionSheet>
  )
}
