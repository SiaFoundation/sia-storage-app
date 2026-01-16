import React, { memo } from 'react'
import { StyleSheet, Pressable } from 'react-native'
import { FileViewer } from '../FileViewer'
import { type FileRecord } from '../../stores/files'
import {
  useAutoDownload,
  detailsShouldAutoDownload,
} from '../../hooks/useAutoDownload'

type Props = {
  file: FileRecord
  textTopInset: number
  onTap?: () => void
  onImageZoomChange?: (isZoomed: boolean) => void
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
}

/**
 * Individual file viewer page in the carousel.
 * Each page independently auto-downloads its file to ensure smooth navigation.
 */
function FileCarouselPageComponent({
  file,
  textTopInset,
  onTap,
  onImageZoomChange,
  onSwipeLeft,
  onSwipeRight,
}: Props) {
  // Each page independently triggers auto-download for its file
  useAutoDownload(file, detailsShouldAutoDownload)

  return (
    <Pressable style={styles.container} onPress={onTap}>
      <FileViewer
        file={file}
        textTopInset={textTopInset}
        onImageZoomChange={onImageZoomChange}
        onSwipeLeft={onSwipeLeft}
        onSwipeRight={onSwipeRight}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
})

// Memoize to prevent unnecessary re-renders when parent state changes
export const FileCarouselPage = memo(FileCarouselPageComponent)
