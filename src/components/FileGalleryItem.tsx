import { View, Pressable, StyleSheet } from 'react-native'
import { colors } from '../styles/colors'
import { type FileRecord } from '../stores/files'
import { FileThumbnail } from './FileThumbnail'
import { memo } from 'react'
import { useFileStatus } from '../lib/file'
import { UploadStatusIcon } from './UploadStatusIcon'

type Props = {
  file: FileRecord
  onPressItem: (item: FileRecord) => void
  onLongPressItem?: (item: FileRecord) => void
}

function FileGalleryItemComponent({
  file,
  onPressItem,
  onLongPressItem,
}: Props) {
  const status = useFileStatus(file)
  return (
    <View collapsable={false} style={styles.thumbCell}>
      <Pressable
        accessibilityRole="button"
        onPress={() => onPressItem(file)}
        style={styles.thumbPress}
        onLongPress={
          onLongPressItem ? () => onLongPressItem(file) : undefined
        }
      >
        <FileThumbnail file={file} iconSize={24} thumbSize={512} />
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
    prev.file.id === next.file.id &&
    prev.file.updatedAt === next.file.updatedAt &&
    prev.file.objects === next.file.objects &&
    prev.onPressItem === next.onPressItem &&
    prev.onLongPressItem === next.onLongPressItem
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
