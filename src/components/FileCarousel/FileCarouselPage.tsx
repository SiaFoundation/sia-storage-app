import React, { memo } from 'react'
import { type GestureResponderEvent } from 'react-native'
import { Animated } from 'react-native'
import { FileViewer } from '../FileViewer'
import { type FileRecord } from '../../stores/files'
import {
  useAutoDownload,
  detailsShouldAutoDownload,
} from '../../hooks/useAutoDownload'

type Props = {
  file: FileRecord
  position: 'prev' | 'current' | 'next'
  translateX: Animated.Value
  screenWidth: number
  textTopInset: number
  onViewerControlPress: () => void
  onImageZoomChange?: (isZoomed: boolean) => void
  onTouchStart: (event: GestureResponderEvent) => void
  onTouchMove: (event: GestureResponderEvent) => void
  onTouchEnd: (event: GestureResponderEvent) => void
}

/**
 * Individual file viewer page in the carousel.
 * Each page independently auto-downloads its file to ensure smooth navigation.
 */
function FileCarouselPageComponent({
  file,
  position,
  translateX,
  screenWidth,
  textTopInset,
  onViewerControlPress,
  onImageZoomChange,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}: Props) {
  // Each page independently triggers auto-download for its file
  useAutoDownload(file, detailsShouldAutoDownload)

  const offset =
    position === 'prev' ? -screenWidth : position === 'next' ? screenWidth : 0

  return (
    <Animated.View
      key={file.id}
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        },
        {
          transform: [
            {
              translateX: Animated.add(translateX, offset),
            },
          ],
        },
      ]}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <FileViewer
        file={file}
        textTopInset={textTopInset}
        onViewerControlPress={onViewerControlPress}
        onImageZoomChange={onImageZoomChange}
      />
    </Animated.View>
  )
}

// Memoize to prevent unnecessary re-renders when parent state changes
export const FileCarouselPage = memo(FileCarouselPageComponent)
