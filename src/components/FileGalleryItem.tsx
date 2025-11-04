import { View, Pressable, StyleSheet } from 'react-native'
import { colors } from '../styles/colors'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'
import { type FileRecord } from '../stores/files'
import { FileThumbnail } from './FileThumbnail'
import { memo } from 'react'
import { useFileStatus } from '../lib/file'
import { UploadStatusIcon } from './UploadStatusIcon'

type Props = {
  file: FileRecord
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
}

function FileGalleryItemComponent({ file, onPressItem, setItemRef }: Props) {
  const toast = useToast()
  const status = useFileStatus(file)
  return (
    <View
      collapsable={false}
      ref={(node) => setItemRef?.(file.id, node)}
      style={styles.thumbCell}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => onPressItem(file)}
        style={styles.thumbPress}
        onLongPress={() => {
          Clipboard.setString(file.id)
          toast.show('Copied item id')
        }}
      >
        <FileThumbnail file={file} iconSize={24} />
        {status.data ? (
          <View style={{ position: 'absolute', bottom: 8, right: 8 }}>
            <UploadStatusIcon status={status.data} size={10} />
          </View>
        ) : null}
      </Pressable>
    </View>
  )
}

export const FileGalleryItem = memo(FileGalleryItemComponent, (prev, next) => {
  return (
    prev.file === next.file &&
    prev.onPressItem === next.onPressItem &&
    prev.setItemRef === next.setItemRef
  )
})

const styles = StyleSheet.create({
  thumbCell: {
    width: '33.33%',
    aspectRatio: 1,
    margin: 0,
    backgroundColor: colors.bgSurface,
    overflow: 'hidden',
  },
  thumbPress: {
    flex: 1,
    position: 'relative',
  },
})
