import { View, Pressable, StyleSheet } from 'react-native'
import { colors, whiteA, palette } from '../styles/colors'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'
import { type FileRecord } from '../stores/files'
import { FileIndicators } from './FileIndicators'
import { FileThumbnail } from './FileThumbnail'
import { memo } from 'react'

type Props = {
  file: FileRecord
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
}

function GalleryItemComponent({ file, onPressItem, setItemRef }: Props) {
  const toast = useToast()
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
        <FileIndicators file={file} size={10} interactive={false} />
      </Pressable>
    </View>
  )
}

export const GalleryItem = memo(GalleryItemComponent, (prev, next) => {
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
