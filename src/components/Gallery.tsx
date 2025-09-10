import { memo } from 'react'
import { View, Image, FlatList, Pressable, StyleSheet } from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'
import UploadStatusIcon from './UploadStatusIcon'
import { type UploadedItem } from '../Upload'
import { useFileRecords } from '../hooks/swrHooks'

type Props = {
  items: UploadedItem[]
  onPressItem: (item: UploadedItem) => void
  setItemRef?: (id: string, ref: any) => void
  numColumns?: number
}

function GalleryComponent({
  items,
  onPressItem,
  setItemRef,
  numColumns = 3,
}: Props) {
  const { data: photos } = useFileRecords()
  const toast = useToast()
  return (
    <FlatList
      data={items}
      keyExtractor={(item) => `${item.createdAt}-${item.uri}`}
      numColumns={numColumns}
      contentContainerStyle={styles.galleryContent}
      renderItem={({ item }) => (
        <View
          collapsable={false}
          ref={(node) => setItemRef?.(item.id, node)}
          style={styles.thumbCell}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => onPressItem(item)}
            style={styles.thumbPress}
            onLongPress={() => {
              Clipboard.setString(item.id)
              toast.show('Copied photo id')
            }}
          >
            <Image
              source={{ uri: item.uri }}
              style={styles.thumbImage}
              resizeMode="cover"
            />
            {item.status === 'uploading' ? (
              <View style={styles.thumbProgressTrack}>
                <View
                  style={[
                    styles.thumbProgressFill,
                    { width: `${Math.round((item.progress ?? 0) * 100)}%` },
                  ]}
                />
              </View>
            ) : null}
            <View style={styles.thumbBadge}>
              <UploadStatusIcon status={item.status} size={16} />
            </View>
          </Pressable>
        </View>
      )}
    />
  )
}

export const Gallery = memo(GalleryComponent)

const styles = StyleSheet.create({
  galleryContent: { padding: 0 },
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
})

export default Gallery
