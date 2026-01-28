import { CameraIcon, FileIcon, ImageIcon } from 'lucide-react-native'
import { useCameraCaptureAndUpload } from '../hooks/useCameraCapture'
import { useDocumentPickerAndUpload } from '../hooks/useDocumentPicker'
import { useImagePickerAndUpload } from '../hooks/useImagePicker'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { ActionSheet } from './ActionSheet'
import { ActionSheetButton } from './ActionSheetButton'

export function AddFileActionSheet() {
  const isOpen = useSheetOpen('addFile')
  const imagePickerAndUpload = useImagePickerAndUpload()
  const captureAndUpload = useCameraCaptureAndUpload()
  const documentPickerAndUpload = useDocumentPickerAndUpload()

  return (
    <ActionSheet visible={isOpen} onRequestClose={closeSheet}>
      <ActionSheetButton
        icon={<CameraIcon size={18} />}
        onPress={async () => {
          await closeSheet()
          void captureAndUpload()
        }}
      >
        Take Photo or Video
      </ActionSheetButton>
      <ActionSheetButton
        testID="action-choose-from-photos"
        icon={<ImageIcon size={18} />}
        onPress={async () => {
          await closeSheet()
          void imagePickerAndUpload()
        }}
      >
        Choose from Photos
      </ActionSheetButton>
      <ActionSheetButton
        icon={<FileIcon size={18} />}
        onPress={async () => {
          await closeSheet()
          void documentPickerAndUpload()
        }}
      >
        Import from Files
      </ActionSheetButton>
    </ActionSheet>
  )
}
