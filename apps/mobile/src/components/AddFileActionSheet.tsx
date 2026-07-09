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
}

export function AddFileActionSheet({
  sheetName = 'addFile',
  destinationDirectoryId = null,
  assignTagName,
}: Props) {
  const isOpen = useSheetOpen(sheetName)
  const pickerOptions = { destinationDirectoryId, assignTagName }
  const pickImages = useImagePicker(pickerOptions)
  const capture = useCameraCapture(pickerOptions)
  const pickDocuments = useDocumentPicker(pickerOptions)

  const pickAndClose = useCallback(async (picker: () => Promise<void>) => {
    await closeSheet()
    await picker()
  }, [])

  return (
    <ActionSheet visible={isOpen} onRequestClose={closeSheet}>
      <ActionSheetButton
        testID="action-take-photo"
        icon={<CameraIcon size={18} />}
        onPress={() => void pickAndClose(capture)}
      >
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
        testID="action-import-from-files"
        icon={<FileIcon size={18} />}
        onPress={() => void pickAndClose(pickDocuments)}
      >
        Import from Files
      </ActionSheetButton>
    </ActionSheet>
  )
}
