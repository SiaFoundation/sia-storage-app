import Clipboard from '@react-native-clipboard/clipboard'
import * as ScreenOrientation from 'expo-screen-orientation'
import { EyeIcon, EyeOffIcon } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Carousel, {
  type ICarouselInstance,
} from 'react-native-reanimated-carousel'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Share from 'react-native-share'
import {
  getOneSealedObject,
  getPinnedObject,
  useFileStatus,
} from '../../lib/file'
import { logger } from '../../lib/logger'
import { generateSiaShareUrl } from '../../lib/shareUrl'
import { useToast } from '../../lib/toastContext'
import { useVirtualFileList } from '../../stores/fileCarousel'
import type { FileRecord } from '../../stores/files'
import { useSdk } from '../../stores/sdk'
import { palette } from '../../styles/colors'
import BlocksLoader from '../BlocksLoader'
import { FileDetails } from '../FileDetails'
import { FileCarouselControlBar } from './FileCarouselControlBar'
import { FileCarouselHeader } from './FileCarouselHeader'
import { FileCarouselPage } from './FileCarouselPage'

type Props = {
  initialId: string
  initialFile?: FileRecord
  onClose: () => void
  onShowActionSheet?: () => void
  onZoomChange?: (isZoomed: boolean) => void
  isDismissing?: boolean
}

export function FileCarousel({
  initialId,
  initialFile,
  onClose,
  onShowActionSheet,
  onZoomChange,
  isDismissing,
}: Props) {
  const [viewStyle, setViewStyle] = useState<'consume' | 'detail'>('consume')
  const [showChrome, setShowChrome] = useState(false)

  // Hide chrome during drag-to-dismiss
  useEffect(() => {
    if (isDismissing) {
      setShowChrome(false)
    }
  }, [isDismissing])
  const [isScreenReaderEnabled, setIsScreenReaderEnabled] = useState(false)
  const [isZoomed, setIsZoomed] = useState(false)

  const toast = useToast()

  const handleFileDeleted = useCallback(() => {
    toast.show('File deleted')
    onClose()
  }, [onClose, toast])

  const handleFileUpdated = useCallback(
    (message: string) => {
      toast.show(message)
    },
    [toast],
  )

  const {
    totalCount,
    currentIndex,
    currentFile,
    getFileAtIndex,
    setCurrentIndex,
    isLoading,
  } = useVirtualFileList({
    initialId,
    initialFile,
    prefetchRadius: 3,
    maxCacheSize: 50,
    onDeleted: handleFileDeleted,
    onUpdated: handleFileUpdated,
  })

  const [viewerSize, setViewerSize] = useState({ width: 0, height: 0 })

  const insets = useSafeAreaInsets()
  const sdk = useSdk()
  const carouselRef = useRef<ICarouselInstance>(null)

  const handleViewerLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setViewerSize({ width, height })
  }, [])

  const status = useFileStatus(currentFile ?? undefined)

  const carouselData = useMemo(() => {
    return Array.from({ length: totalCount }, (_, i) => i)
  }, [totalCount])

  // Scroll to the file's position once we know it. The carousel's defaultIndex
  // only works on mount, but currentIndex is determined asynchronously after
  // querying the DB for the file's position in the sorted list. Once totalCount
  // transitions from placeholder (0 or 1) to the real count, scroll to position.
  const hasScrolledToInitialPosition = useRef(false)
  const previousTotalCount = useRef(totalCount)

  useEffect(() => {
    const wasInitial = previousTotalCount.current <= 1
    const isNowReal = totalCount > 1
    const carousel = carouselRef.current
    const carouselReady = viewerSize.width > 0 && carousel

    if (
      wasInitial &&
      isNowReal &&
      carouselReady &&
      !hasScrolledToInitialPosition.current
    ) {
      hasScrolledToInitialPosition.current = true
      carousel.scrollTo({ index: currentIndex, animated: false })
    }
    previousTotalCount.current = totalCount
  }, [totalCount, currentIndex, viewerSize.width])

  // Unlock screen orientation.
  useEffect(() => {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.DEFAULT,
    ).catch(() => {})
    return () => {
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => {})
    }
  }, [])

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setIsScreenReaderEnabled)
    const sub = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      setIsScreenReaderEnabled,
    )
    return () => {
      sub.remove()
    }
  }, [])

  const handleShareURL = useCallback(async () => {
    if (!currentFile || !sdk) return
    try {
      const result = getOneSealedObject(currentFile)
      if (!result) return
      const pinnedObject = await getPinnedObject(
        result.indexerURL,
        result.sealedObject,
      )
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 1)
      const shareUrl = await generateSiaShareUrl(sdk, pinnedObject, expiresAt)
      if (!shareUrl) return
      Clipboard.setString(shareUrl)
      toast.show('Share URL copied')
    } catch (e) {
      logger.error('FileCarousel', 'Failed to share URL', e)
      toast.show('Failed to copy URL')
    }
  }, [currentFile, sdk, toast])

  const handleShareFile = useCallback(async () => {
    if (!currentFile?.type || !status.data?.fileUri) return
    try {
      await Share.open({
        url: status.data.fileUri,
        type: currentFile.type,
        filename: currentFile.name ?? undefined,
        subject: `Sia Storage - ${currentFile.type}`,
      })
    } catch (e) {
      if (typeof e === 'string' && !e.includes('User did not share')) {
        logger.error('FileCarousel', 'File sharing failed', e)
      }
    }
  }, [currentFile, status.data?.fileUri])

  const handleMore = useCallback(() => {
    if (onShowActionSheet) {
      onShowActionSheet()
    }
  }, [onShowActionSheet])

  const toggleControlsVisibility = useCallback(() => {
    setShowChrome((curr) => !curr)
  }, [])

  const handleImageZoomChange = useCallback(
    (zoomed: boolean) => {
      setIsZoomed(zoomed)
      onZoomChange?.(zoomed)
    },
    [onZoomChange],
  )

  const handleSnapToItem = useCallback(
    (index: number) => {
      setCurrentIndex(index)
      setIsZoomed(false)
    },
    [setCurrentIndex],
  )

  const goToPrev = useCallback(() => {
    carouselRef.current?.prev()
  }, [])

  const goToNext = useCallback(() => {
    carouselRef.current?.next()
  }, [])

  const navigationProxy = useMemo(() => ({ goBack: onClose }), [onClose])

  const renderItem = useCallback(
    ({ item: index }: { item: number }) => {
      const file = getFileAtIndex(index)

      if (!file) {
        return (
          <View style={styles.center}>
            <BlocksLoader size={20} />
          </View>
        )
      }

      if (viewStyle === 'detail') {
        return (
          <FileDetails
            file={file}
            header={
              <FileCarouselHeader
                file={file}
                title={file.name ?? 'Details'}
                navigation={navigationProxy}
                icon="close"
              />
            }
          />
        )
      }

      return (
        <FileCarouselPage
          file={file}
          textTopInset={insets.top}
          onTap={toggleControlsVisibility}
          onImageZoomChange={handleImageZoomChange}
          onSwipeLeft={goToNext}
          onSwipeRight={goToPrev}
        />
      )
    },
    [
      insets.top,
      toggleControlsVisibility,
      getFileAtIndex,
      handleImageZoomChange,
      goToNext,
      goToPrev,
      viewStyle,
      navigationProxy,
    ],
  )

  return (
    <View style={styles.container}>
      {showChrome && viewStyle === 'consume' ? (
        <View style={styles.headerOverlay} pointerEvents="box-none">
          <FileCarouselHeader
            file={currentFile ?? undefined}
            title={currentFile?.name ?? 'View'}
            navigation={navigationProxy}
            icon="close"
          />
        </View>
      ) : null}

      {currentFile ? (
        <View style={styles.viewer} onLayout={handleViewerLayout}>
          {carouselData.length > 0 && viewerSize.width > 0 && (
            <Carousel
              ref={carouselRef}
              data={carouselData}
              renderItem={renderItem}
              width={viewerSize.width}
              height={viewerSize.height}
              defaultIndex={currentIndex}
              onSnapToItem={handleSnapToItem}
              loop={false}
              enabled={!isZoomed}
              windowSize={5}
              onConfigurePanGesture={(gesture) => {
                gesture.activeOffsetX([-10, 10])
              }}
            />
          )}
        </View>
      ) : isLoading ? (
        <View style={styles.center}>
          <BlocksLoader size={20} />
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.text}>File not found</Text>
        </View>
      )}
      {currentFile && (showChrome || viewStyle === 'detail') ? (
        <View
          style={[
            styles.controlBarOverlay,
            { paddingBottom: insets.bottom + 12 },
          ]}
          pointerEvents="box-none"
        >
          <FileCarouselControlBar
            viewStyle={viewStyle}
            setViewStyle={setViewStyle}
            onShareFile={handleShareFile}
            onShareURL={handleShareURL}
            onPressMore={handleMore}
            canShare={status.data?.isUploaded ?? false}
          />
        </View>
      ) : null}
      {isScreenReaderEnabled ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showChrome ? 'Hide controls' : 'Show controls'}
          accessibilityHint="Toggles navigation and actions"
          style={styles.accessibilityToggle}
          onPress={toggleControlsVisibility}
        >
          <View style={styles.accessibilityToggleInner}>
            {showChrome ? (
              <EyeOffIcon color={palette.gray[50]} size={20} />
            ) : (
              <EyeIcon color={palette.gray[50]} size={20} />
            )}
          </View>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: palette.gray[50],
  },
  viewer: { flex: 1 },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  controlBarOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  accessibilityToggle: {
    position: 'absolute',
    right: 12,
    top: '50%',
    marginTop: -20,
    zIndex: 30,
    elevation: 5, // Android shadow
  },
  accessibilityToggleInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.gray[800],
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.gray[700],
  },
})
