import { View, Image, Pressable, StyleSheet } from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'
import { type FileRecord } from '../stores/files'
import { PlayIcon } from 'lucide-react-native'
import { useFileStatus } from '../lib/file'
import { FileIndicators } from './FileIndicators'
import { FileThumbnail } from './FileThumbnail'

type Props = {
  file: FileRecord
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
}

export function GalleryItem({ file, onPressItem, setItemRef }: Props) {
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
        <FileIndicators file={file} size={10} interactive={false} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  thumbCell: {
    flex: 1,
    aspectRatio: 1,
    margin: 0,
    backgroundColor: '#ffffff',
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  thumbPress: {
    flex: 1,
    position: 'relative',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  thumbBadgeRow: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  videoThumb: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  thumbProgressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  thumbProgressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
  },
  thumbCenter: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleOuter: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d0d7de',
    backgroundColor: 'rgba(255,255,255,0.85)',
    overflow: 'hidden',
  },
  circleInner: {
    height: '100%',
    backgroundColor: '#0969da',
  },
})
