import { memo } from 'react'
import { View, Image, FlatList, Pressable, StyleSheet } from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'
import UploadStatusIcon from './UploadStatusIcon'
import { useFileList } from '../lib/filesContext'
import { type FileRecord } from '../db/files'
import { useAllUploadStates as useUploadStatusMap } from '../lib/uploadState'

type Props = {
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
  numColumns?: number
}

export function Gallery({ onPressItem, setItemRef, numColumns = 3 }: Props) {
  const { data: files } = useFileList()
  const toast = useToast()
  const uploadStatusMap = useUploadStatusMap()
  return (
    <FlatList
      data={files}
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
            {(() => {
              const r = uploadStatusMap[item.id]
              const effectiveStatus = (r?.status ??
                (item.metadata ? 'done' : 'error')) as
                | 'uploading'
                | 'done'
                | 'error'
              const progress = r?.progress ?? 0
              return (
                <>
                  {effectiveStatus === 'uploading' ? (
                    <View style={styles.thumbProgressTrack}>
                      <View
                        style={[
                          styles.thumbProgressFill,
                          { width: `${Math.round(progress * 100)}%` },
                        ]}
                      />
                    </View>
                  ) : null}
                  <View style={styles.thumbBadge}>
                    <UploadStatusIcon status={effectiveStatus} size={16} />
                  </View>
                </>
              )
            })()}
          </Pressable>
        </View>
      )}
    />
  )
}

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
