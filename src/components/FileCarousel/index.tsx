import Clipboard from '@react-native-clipboard/clipboard'
import * as ScreenOrientation from 'expo-screen-orientation'
import { EyeIcon, EyeOffIcon } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
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
import { useFileCarousel } from '../../stores/fileCarousel'
import type { FileRecord } from '../../stores/files'
import type { Category, SortBy, SortDir } from '../../stores/library'
import { useSdk } from '../../stores/sdk'
import { palette } from '../../styles/colors'
import BlocksLoader from '../BlocksLoader'
import { useDragToDismissGesture } from '../DragToDismiss'
import { FileDetails } from '../FileDetails'
import { FileCarouselControlBar } from './FileCarouselControlBar'
import { FileCarouselHeader } from './FileCarouselHeader'
import { FileCarouselPage } from './FileCarouselPage'

type Props = {
  initialId: string
  initialFile?: FileRecord
  sortBy?: SortBy
  sortDir?: SortDir
  categories?: Category[]
  onClose: () => void
  onShowActionSheet?: () => void
  onZoomChange?: (isZoomed: boolean) => void
  onViewStyleChange?: (viewStyle: 'consume' | 'detail') => void
  isDismissing?: boolean
}

export function FileCarousel({
  initialId,
  initialFile,
  sortBy,
  sortDir,
  categories,
  onClose,
  onShowActionSheet,
  onZoomChange,
  onViewStyleChange,
  isDismissing,
}: Props) {
  const [viewStyle, _setViewStyle] = useState<'consume' | 'detail'>('consume')

  const setViewStyle = useCallback(
    (style: 'consume' | 'detail') => {
      _setViewStyle(style)
      onViewStyleChange?.(style)
      // Keep controls visible when switching back from detail view,
      // since the user just interacted with the control bar toggle.
      if (style === 'consume') {
        setShowChrome(true)
      }
    },
    [onViewStyleChange],
  )
  const [showChrome, setShowChrome] = useState(false)
  const [isScreenReaderEnabled, setIsScreenReaderEnabled] = useState(false)
  const [isZoomed, setIsZoomed] = useState(false)

  const toast = useToast()

  const handleFileDeleted = useCallback(() => {
    toast.show('File deleted')
    onClose()
  }, [onClose, toast])

  const {
    totalCount,
    currentIndex,
    currentFile,
    getFileAtIndex,
    setCurrentIndex,
  } = useFileCarousel({
    initialId,
    initialFile,
    sortBy,
    sortDir,
    categories,
    prefetchRadius: 3,
    maxCacheSize: 50,
    onDeleted: handleFileDeleted,
  })

  const [viewerSize, setViewerSize] = useState({ width: 0, height: 0 })

  const insets = useSafeAreaInsets()
  const sdk = useSdk()
  const carouselRef = useRef<ICarouselInstance>(null)
  const dragToDismissGesture = useDragToDismissGesture()

  const handleViewerLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setViewerSize({ width, height })
  }, [])

  const status = useFileStatus(currentFile ?? undefined)

  const carouselData = useMemo(() => {
    return Array.from({ length: totalCount }, (_, i) => i)
  }, [totalCount])

  const isDetailView = viewStyle === 'detail'

  // Opacity swap: render the initial file directly while the carousel mounts
  // invisibly behind it, then atomically swap after 2 animation frames. This
  // avoids a flicker where the carousel briefly shows index 0 before scrolling
  // to the correct defaultIndex position.
  const showCarousel = carouselData.length > 1 && viewerSize.width > 0
  const [carouselReady, setCarouselReady] = useState(false)

  useEffect(() => {
    if (!showCarousel) return
    let cancelled = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setCarouselReady(true)
      })
    })
    return () => {
      cancelled = true
    }
  }, [showCarousel])

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
      const msg =
        typeof e === 'string' ? e : e instanceof Error ? e.message : ''
      if (!msg.includes('User did not share')) {
        logger.error('FileCarousel', 'share_failed', { error: e as Error })
      }
    }
  }, [currentFile, status.data?.fileUri])

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
      logger.error('FileCarousel', 'share_url_failed', { error: e as Error })
      toast.show('Failed to copy URL')
    }
  }, [currentFile, sdk, toast])

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
          <Pressable style={styles.center} onPress={toggleControlsVisibility}>
            <BlocksLoader size={20} />
          </Pressable>
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
    ],
  )

  return (
    <View style={styles.container}>
      {showChrome && !isDetailView && !isDismissing ? (
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
          {/* Both views stay mounted to preserve state across toggles.
              The inactive view is hidden with opacity:0 + pointerEvents:none. */}
          <View
            style={isDetailView ? styles.hiddenLayer : styles.activeLayer}
            pointerEvents={isDetailView ? 'none' : 'auto'}
          >
            {/* Base layer: renders the initial file directly so there's no
                gap frame while the carousel mounts invisibly. Hidden once the
                carousel is ready, to prevent it showing through during swipes
                or zoom/pan. */}
            <View
              style={carouselReady ? styles.hiddenLayer : styles.activeLayer}
              pointerEvents={carouselReady ? 'none' : 'auto'}
            >
              {renderItem({ item: currentIndex })}
            </View>
            {showCarousel && (
              <View
                style={[
                  styles.absoluteFill,
                  !carouselReady && styles.transparent,
                ]}
                pointerEvents={carouselReady ? 'auto' : 'none'}
              >
                <Carousel
                  ref={carouselRef}
                  data={carouselData}
                  renderItem={renderItem}
                  width={viewerSize.width}
                  height={viewerSize.height}
                  defaultIndex={currentIndex}
                  onSnapToItem={handleSnapToItem}
                  loop={false}
                  enabled={!isZoomed && !isDismissing}
                  windowSize={5}
                  onConfigurePanGesture={(gesture) => {
                    gesture.activeOffsetX([-10, 10])
                    // Android: carousel waits for DragToDismiss to fail
                    // (horizontal movement) before activating. Prevents
                    // diagonal drags from swiping the carousel sideways
                    // during drag-to-dismiss.
                    if (Platform.OS === 'android' && dragToDismissGesture) {
                      gesture.requireExternalGestureToFail(dragToDismissGesture)
                    }
                  }}
                />
              </View>
            )}
          </View>
          {/* Detail view uses RNGH ScrollView so it can scroll within the
              DragToDismiss GestureDetector hierarchy on Android. */}
          <View
            style={[styles.absoluteFill, !isDetailView && styles.hiddenLayer]}
            pointerEvents={isDetailView ? 'auto' : 'none'}
          >
            <FileDetails
              file={currentFile}
              header={
                <FileCarouselHeader
                  file={currentFile}
                  title={currentFile.name ?? 'Details'}
                  navigation={navigationProxy}
                  icon="close"
                />
              }
            />
          </View>
        </View>
      ) : (
        <Pressable style={styles.center} onPress={toggleControlsVisibility}>
          <BlocksLoader size={20} />
        </Pressable>
      )}
      {currentFile && (showChrome || isDetailView) && !isDismissing ? (
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
  viewer: { flex: 1 },
  activeLayer: { flex: 1 },
  hiddenLayer: { flex: 1, opacity: 0 },
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  transparent: { opacity: 0 },
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
