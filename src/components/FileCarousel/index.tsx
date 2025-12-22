import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import {
  View,
  StyleSheet,
  Text,
  PanResponder,
  type GestureResponderEvent,
  type NativeTouchEvent,
  AccessibilityInfo,
  Pressable,
  Animated,
  Dimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Clipboard from '@react-native-clipboard/clipboard'
import Share from 'react-native-share'
import * as ScreenOrientation from 'expo-screen-orientation'
import { EyeIcon, EyeOffIcon } from 'lucide-react-native'

import { palette } from '../../styles/colors'
import BlocksLoader from '../BlocksLoader'
import { useFileCarouselWindow } from '../../stores/fileCarousel'
import { FileRecord } from '../../stores/files'
import { FileCarouselHeader } from './FileCarouselHeader'
import { FileCarouselControlBar } from './FileCarouselControlBar'
import { FileCarouselPage } from './FileCarouselPage'
import { FileDetails } from '../FileDetails'
import { useSdk } from '../../stores/sdk'
import { getOneSealedObject, getPinnedObject, useFileStatus } from '../../lib/file'
import { generateSiaShareUrl } from '../../lib/shareUrl'
import { logger } from '../../lib/logger'

type Props = {
  initialId: string
  initialFile?: FileRecord
  onClose: () => void
  onShowActionSheet?: () => void
}

type TapState = {
  id: string
  startX: number
  startY: number
  startedAt: number
  moved: boolean
}

export function FileCarousel({ initialId, initialFile, onClose, onShowActionSheet }: Props) {
  const [viewStyle, setViewStyle] = useState<'consume' | 'detail'>('consume')
  const [showChrome, setShowChrome] = useState(false)
  const [localToast, setLocalToast] = useState<string | null>(null)
  const [isScreenReaderEnabled, setIsScreenReaderEnabled] = useState(false)

  // Use the refactored hook that manages file list window and state
  const { currentFile, prevFile, nextFile, setCurrentFile, isValidating } =
    useFileCarouselWindow({
      initialId,
      initialFile,
      windowSize: 1,
    })

  const insets = useSafeAreaInsets()
  const sdk = useSdk()
  const tapStateRef = useRef<TapState | null>(null)
  const shouldIgnoreNextToggleRef = useRef(false)
  const imageZoomRef = useRef({ isZoomed: false })
  const screenWidth = Dimensions.get('window').width

  // Create fresh Animated.Value when currentFile changes to avoid stale native driver values
  const translateX = useMemo(() => {
    return new Animated.Value(0)
  }, [currentFile?.id])

  const status = useFileStatus(currentFile ?? undefined)

  // Unlock screen orientation when carousel opens, lock back to portrait when closed
  useEffect(() => {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.DEFAULT
    ).catch(() => {
      // Ignore platform errors or permission issues
    })

    return () => {
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP
      ).catch(() => {
        // Ignore platform errors or permission issues
      })
    }
  }, [])

  // Detect screen reader for accessibility toggle
  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setIsScreenReaderEnabled)
    const sub = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      setIsScreenReaderEnabled
    )
    return () => {
      sub.remove()
    }
  }, [])

  // Local toast handler for modal context
  const showToast = useCallback((message: string) => {
    setLocalToast(message)
    setTimeout(() => setLocalToast(null), 1400)
  }, [])

  // Share URL handler - copies to clipboard and shows toast
  const handleShareURL = useCallback(async () => {
    if (!currentFile || !sdk) return
    try {
      const result = getOneSealedObject(currentFile)
      if (!result) return
      const pinnedObject = await getPinnedObject(
        result.indexerURL,
        result.sealedObject
      )
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 1)
      const shareUrl = await generateSiaShareUrl(sdk, pinnedObject, expiresAt)
      if (!shareUrl) return
      Clipboard.setString(shareUrl)
      showToast('Share URL copied')
    } catch (e) {
      logger.error('FileCarousel', 'Failed to share URL', e)
      showToast('Failed to copy URL')
    }
  }, [currentFile, sdk, showToast])

  // Share file handler - opens native share sheet
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

  // More button handler - opens action sheet outside modal
  const handleMore = useCallback(() => {
    if (onShowActionSheet) {
      onShowActionSheet()
    }
  }, [onShowActionSheet])

  const blockNextControlToggle = useCallback(() => {
    shouldIgnoreNextToggleRef.current = true
  }, [])

  const toggleControlsVisibility = useCallback(() => {
    setShowChrome((curr) => !curr)
  }, [])

  const handleImageZoomChange = useCallback((isZoomed: boolean) => {
    imageZoomRef.current.isZoomed = isZoomed
  }, [])

  const handleTouchStart = useCallback((event: GestureResponderEvent) => {
    const touches = event.nativeEvent.touches
    if (touches.length !== 1) {
      tapStateRef.current = null
      return
    }
    const touch = touches[0]
    const id = normalizeIdentifier(touch)
    tapStateRef.current = {
      id,
      startX: touch.pageX,
      startY: touch.pageY,
      startedAt: Date.now(),
      moved: false,
    }
  }, [])

  const handleTouchMove = useCallback((event: GestureResponderEvent) => {
    const state = tapStateRef.current
    if (!state) return
    const touches = event.nativeEvent.touches
    const target = touches.find((t) => normalizeIdentifier(t) === state.id)
    if (!target) {
      tapStateRef.current = null
      return
    }
    if (!state.moved) {
      const dx = target.pageX - state.startX
      const dy = target.pageY - state.startY
      if (Math.hypot(dx, dy) > 10) state.moved = true
    }
  }, [])

  const handleTouchEnd = useCallback(
    (event: GestureResponderEvent) => {
      const state = tapStateRef.current
      if (!state) return
      const changedTouch = event.nativeEvent.changedTouches.find(
        (t) => normalizeIdentifier(t) === state.id
      )
      if (!changedTouch) return
      const duration = Date.now() - state.startedAt
      if (
        !state.moved &&
        duration < 250 &&
        event.nativeEvent.touches.length === 0
      ) {
        if (shouldIgnoreNextToggleRef.current) {
          shouldIgnoreNextToggleRef.current = false
          tapStateRef.current = null
          return
        }
        toggleControlsVisibility()
      }
      tapStateRef.current = null
    },
    [toggleControlsVisibility]
  )

  const handlePrev = useCallback(() => {
    if (!prevFile || isValidating) return
    setCurrentFile(prevFile)
  }, [prevFile, isValidating])

  const handleNext = useCallback(() => {
    if (!nextFile || isValidating) return
    setCurrentFile(nextFile)
  }, [nextFile, isValidating])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) => {
          // Disable swipe navigation when image is zoomed
          if (imageZoomRef.current.isZoomed) {
            return false
          }
          return (
            gesture.numberActiveTouches === 1 &&
            Math.abs(gesture.dx) > Math.abs(gesture.dy) &&
            Math.abs(gesture.dx) > 10
          )
        },
        onPanResponderGrant: () => {
          translateX.stopAnimation()
        },
        onPanResponderMove: (_, gesture) => {
          // Only allow swiping in valid directions
          if (gesture.dx > 0 && !prevFile) return // Trying to swipe right but no previous
          if (gesture.dx < 0 && !nextFile) return // Trying to swipe left but no next

          translateX.setValue(gesture.dx)
        },
        onPanResponderRelease: (_, gesture) => {
          const threshold = screenWidth * 0.3 // 30% of screen width
          const velocity = gesture.vx

          // Decide whether to snap to next/prev or spring back
          if (gesture.dx > threshold || (velocity > 0.5 && gesture.dx > 50)) {
            // Swipe right to previous
            if (prevFile) {
              Animated.spring(translateX, {
                toValue: screenWidth,
                useNativeDriver: true,
                tension: 65,
                friction: 10,
              }).start(handlePrev)
            } else {
              // No previous, spring back
              Animated.spring(translateX, {
                toValue: 0,
                useNativeDriver: true,
                tension: 65,
                friction: 10,
              }).start()
            }
          } else if (gesture.dx < -threshold || (velocity < -0.5 && gesture.dx < -50)) {
            // Swipe left to next
            if (nextFile) {
              Animated.spring(translateX, {
                toValue: -screenWidth,
                useNativeDriver: true,
                tension: 65,
                friction: 10,
              }).start(handleNext)
            } else {
              // No next, spring back
              Animated.spring(translateX, {
                toValue: 0,
                useNativeDriver: true,
                tension: 65,
                friction: 10,
              }).start()
            }
          } else {
            // Didn't meet threshold, spring back to center
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
              tension: 65,
              friction: 10,
            }).start()
          }
        },
      }),
    [translateX, screenWidth, prevFile, nextFile, handlePrev, handleNext, isValidating]
  )

  const navigationProxy = useMemo(() => ({ goBack: onClose } as any), [onClose])

  // Render a file viewer at a specific position
  const renderFileViewer = (fileToRender: FileRecord | undefined, position: 'prev' | 'current' | 'next') => {
    if (!fileToRender) return null

    return (
      <FileCarouselPage
        key={fileToRender.id}
        file={fileToRender}
        position={position}
        translateX={translateX}
        screenWidth={screenWidth}
        textTopInset={insets.top}
        onViewerControlPress={blockNextControlToggle}
        onImageZoomChange={position === 'current' ? handleImageZoomChange : undefined}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
    )
  }

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
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
        viewStyle === 'consume' ? (
          <View style={styles.viewer} pointerEvents="box-none">
            {renderFileViewer(prevFile, 'prev')}
            {renderFileViewer(currentFile, 'current')}
            {renderFileViewer(nextFile, 'next')}
          </View>
        ) : (
          <View style={styles.viewer}>
            <FileDetails
              file={currentFile}
              header={
                <FileCarouselHeader
                  file={currentFile}
                  title={currentFile?.name ?? 'Details'}
                  navigation={navigationProxy}
                  icon="close"
                />
              }
            />
          </View>
        )
      ) : !currentFile ? (
        <View style={styles.center}>
          <BlocksLoader size={20} />
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.text}>File not found</Text>
        </View>
      )}
      {currentFile && showChrome ? (
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
      {localToast ? (
        <View style={styles.toastOverlay} pointerEvents="none">
          <View style={styles.toast}>
            <Text style={styles.toastText}>{localToast}</Text>
          </View>
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
    backgroundColor: palette.gray[950],
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
  fileViewerPage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
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
  toastOverlay: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  toast: {
    backgroundColor: palette.gray[800],
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderColor: palette.gray[700],
    borderWidth: StyleSheet.hairlineWidth,
  },
  toastText: {
    color: palette.gray[50],
    fontWeight: '600',
    fontSize: 14,
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

const normalizeIdentifier = (touch: NativeTouchEvent) =>
  touch.identifier != null
    ? String(touch.identifier)
    : `${touch.pageX}-${touch.pageY}`
