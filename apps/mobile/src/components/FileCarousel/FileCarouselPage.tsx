import type { FileRecord } from '@siastorage/core/types'
import { memo } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import {
  detailsShouldAutoDownload,
  useAutoDownload,
} from '../../hooks/useAutoDownload'
import { FileViewer } from '../FileViewer'

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
