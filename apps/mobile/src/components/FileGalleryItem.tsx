import { CircleCheckIcon, CircleIcon } from 'lucide-react-native'
import { memo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import {
  type FileItemProps,
  fileItemPropsAreEqual,
  useFileStatus,
} from '../lib/file'
import { useIsFileSelected, useIsSelectionMode } from '../stores/fileSelection'
import { colors, palette, whiteA } from '../styles/colors'
import { FileThumbnail } from './FileThumbnail'
import { UploadStatusIcon } from './UploadStatusIcon'

type Props = FileItemProps

function FileGalleryItemComponent({
  file,
  onPressItem,
  onLongPressItem,
}: Props) {
  const isSelectionMode = useIsSelectionMode()
  const isSelected = useIsFileSelected(file.id)

  const status = useFileStatus(file)
  return (
    <View collapsable={false} style={styles.thumbCell}>
      <Pressable
        accessibilityRole="button"
        onPress={() => onPressItem(file)}
        style={styles.thumbPress}
        onLongPress={onLongPressItem ? () => onLongPressItem(file) : undefined}
      >
        <FileThumbnail file={file} iconSize={24} thumbSize={512} />
        {isSelectionMode ? (
          <>
            {isSelected && <View style={styles.selectedOverlay} />}
            <View style={styles.checkboxContainer}>
              {isSelected ? (
                <View style={styles.checkboxSelected}>
                  <CircleCheckIcon
                    size={18}
                    color={palette.blue[500]}
                    fill={palette.gray[50]}
                  />
                </View>
              ) : (
                <View style={styles.checkboxUnselected}>
                  <CircleIcon size={18} color={whiteA.a70} />
                </View>
              )}
            </View>
          </>
        ) : status.data ? (
          <View style={styles.statusContainer}>
            <UploadStatusIcon status={status.data} size={10} />
          </View>
        ) : null}
      </Pressable>
    </View>
  )
}

export const FileGalleryItem = memo(
  FileGalleryItemComponent,
  fileItemPropsAreEqual,
)

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
  statusContainer: {
    position: 'absolute',
    bottom: 8,
    right: 8,
  },
  checkboxContainer: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  checkboxSelected: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  checkboxUnselected: {
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
    overflow: 'hidden',
  },
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
})
