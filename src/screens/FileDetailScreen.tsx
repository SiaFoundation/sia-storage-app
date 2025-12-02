import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  StyleSheet,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeTouchEvent,
  AccessibilityInfo,
  Pressable,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { useFocusEffect } from '@react-navigation/native'
import * as ScreenOrientation from 'expo-screen-orientation'
import PagerView from 'react-native-pager-view'

import { FileDetails } from '../components/FileDetails'
import { FileDetailsControlBar } from '../components/FileDetailsControlBar'
import { FileDetailScreenHeader } from '../components/FileDetailScreenHeader'
import { FileViewer } from '../components/FileViewer'
import { FileActionsSheet } from '../components/FileActionsSheet'
import { palette } from '../styles/colors'
import { type FileRecord } from '../stores/files'
import { useFileList } from '../stores/library'
import { useFlatListControls } from '../hooks/useFlatListControls'
import { type MainStackParamList } from '../stacks/types'
import {
  detailsShouldAutoDownload,
  useAutoDownload,
} from '../hooks/useAutoDownload'

type Props = NativeStackScreenProps<MainStackParamList, 'FileDetail'>

type TapState = {
  id: string
  startX: number
  startY: number
  startedAt: number
  moved: boolean
}

export function FileDetailScreen({ route, navigation }: Props) {
  const [viewStyle, setViewStyle] = useState<'consume' | 'detail'>('consume')
  const [activeFileID, setActiveFileID] = useState(route.params.id)
  const [areControlsVisible, setAreControlsVisible] = useState(false)
  const [isScreenReaderEnabled, setIsScreenReaderEnabled] = useState(false)
  const [currentPageIndex, setCurrentPageIndex] = useState<number | null>(null)
  const [layoutWidth, setLayoutWidth] = useState<number | null>(null)
  const {
    top: topInset,
    left: leftInset,
    right: rightInset,
  } = useSafeAreaInsets()
  const tapStateRef = useRef<TapState | null>(null)
  const shouldIgnoreNextToggleRef = useRef(false)

  const blockNextControlToggle = useCallback(() => {
    shouldIgnoreNextToggleRef.current = true
  }, [])

  const toggleControlsVisibility = useCallback(() => {
    setAreControlsVisible((curr) => !curr)
  }, [])

  const { data: fileList, size, setSize, isValidating, hasMore } = useFileList()
  const { width } = useWindowDimensions()
  const files = useMemo(() => fileList ?? [], [fileList])
  const file = useMemo(
    () => files.find((item) => item.id === activeFileID),
    [files, activeFileID]
  )

  const pagerRef = useRef<PagerView>(null)
  const hasAlignedInitialIndex = useRef(false)

  const initialTargetIndex = useMemo(
    () => files.findIndex((item) => item.id === route.params.id),
    [files, route.params.id]
  )
  const initialIndex = initialTargetIndex === -1 ? 0 : initialTargetIndex
  const activeIndex = useMemo(
    () => files.findIndex((item) => item.id === activeFileID),
    [activeFileID, files]
  )
  const canPage = files.length > 0 && initialTargetIndex !== -1
  const activeIndexForWindow = activeIndex === -1 ? initialIndex : activeIndex
  const windowStart = Math.max(0, activeIndexForWindow - 1)
  const windowEnd = Math.min(files.length, activeIndexForWindow + 2)
  const windowFiles = useMemo(
    () => files.slice(windowStart, windowEnd),
    [files, windowEnd, windowStart]
  )
  const initialWindowPage = Math.max(0, activeIndexForWindow - windowStart)
  const availableWidth = useMemo(() => {
    const safeWidth = width - leftInset - rightInset
    return layoutWidth ?? safeWidth
  }, [layoutWidth, leftInset, rightInset, width])

  const { handleEndReached } = useFlatListControls({
    data: fileList,
    size,
    setSize,
    isValidating,
    hasMore,
  })

  const loadMoreIfAvailable = useCallback(
    (index: number) => {
      if (index >= files.length - 2) {
        handleEndReached()
      }
    },
    [files.length, handleEndReached]
  )

  useFocusEffect(
    useCallback(() => {
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.DEFAULT
      ).catch(() => {
        // We would end up here because of a platform error or permissions issue.
        // It can likely be ignored.
      })

      return () => {
        ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.PORTRAIT_UP
        ).catch(() => {
          // We would end up here because of a platform error or permissions issue.
          // It can likely be ignored.
        })
      }
    }, [])
  )

  useEffect(() => {
    setActiveFileID(route.params.id)
    hasAlignedInitialIndex.current = false
  }, [route.params.id])

  const lastAlignedWidthRef = useRef<number | null>(null)

  useEffect(() => {
    if (!canPage) return
    if (activeIndex === -1) return
    const targetPage = activeIndex - windowStart
    if (targetPage < 0 || targetPage >= windowFiles.length) return

    const widthChanged = lastAlignedWidthRef.current !== availableWidth
    const needsPageChange =
      currentPageIndex == null || currentPageIndex !== activeIndex

    if (needsPageChange || widthChanged) {
      requestAnimationFrame(() => {
        pagerRef.current?.setPageWithoutAnimation(targetPage)
      })
      lastAlignedWidthRef.current = availableWidth
      setCurrentPageIndex(activeIndex)
    }
  }, [
    availableWidth,
    canPage,
    currentPageIndex,
    activeIndex,
    windowFiles.length,
    windowStart,
  ])

  useEffect(() => {
    if (!canPage || hasAlignedInitialIndex.current) return
    const index = activeIndexForWindow
    const targetPage = index - windowStart
    if (targetPage < 0 || targetPage >= windowFiles.length) return
    requestAnimationFrame(() => {
      try {
        pagerRef.current?.setPageWithoutAnimation(targetPage)
      } catch (e) {
        // ignore until pager is ready
      }
    })
    setCurrentPageIndex(index)
    hasAlignedInitialIndex.current = true
  }, [activeIndexForWindow, canPage, route.params.id, windowFiles.length, windowStart])

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

  const handleSetViewStyle = useCallback(
    (next: 'consume' | 'detail') => {
      if (next === viewStyle) return
      setViewStyle(next)
    },
    [viewStyle]
  )

  const handlePageSelected = useCallback(
    (event: { nativeEvent: { position: number } }) => {
      const position = event.nativeEvent.position
      const fileIndex = windowStart + position
      const next = files[fileIndex]
      if (next && next.id !== activeFileID) {
        setActiveFileID(next.id)
      }
      setCurrentPageIndex(fileIndex)
      loadMoreIfAvailable(fileIndex)
    },
    [activeFileID, files, loadMoreIfAvailable, windowStart]
  )

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

  const renderConsumeView = useCallback(
    (fileRecord: FileRecord) => (
      <View
        style={styles.consumeContainer}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <FileViewer
          file={fileRecord}
          textTopInset={topInset}
          onViewerControlPress={blockNextControlToggle}
        />
      </View>
    ),
    [
      blockNextControlToggle,
      handleTouchEnd,
      handleTouchMove,
      handleTouchStart,
      topInset,
    ]
  )

  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      setLayoutWidth(event.nativeEvent.layout.width)
    },
    []
  )

  return (
    <View style={styles.container} onLayout={handleLayout}>
      {canPage && file ? (
        <PagerView
          ref={pagerRef}
          style={styles.pager}
          initialPage={initialWindowPage}
          onPageSelected={handlePageSelected}
        >
          {windowFiles.map((item, idx) => (
            <View
              key={`${item.id}-${windowStart + idx}`}
              collapsable={false}
              style={[styles.swipePage, { width: availableWidth }]}
            >
              <AutoDownload file={item}>
                {viewStyle === 'consume' ? (
                  renderConsumeView(item)
                ) : (
                  <FileDetails
                    file={item}
                    header={
                      <FileDetailScreenHeader
                        file={item}
                        title={item?.name ?? 'Details'}
                        navigation={navigation}
                      />
                    }
                  />
                )}
              </AutoDownload>
            </View>
          ))}
        </PagerView>
      ) : (
        file &&
        (viewStyle === 'consume' ? (
          renderConsumeView(file)
        ) : (
          <FileDetails
            file={file}
            header={
              <FileDetailScreenHeader
                file={file}
                title={file?.name ?? 'Details'}
                navigation={navigation}
              />
            }
          />
        ))
      )}

      {file && viewStyle === 'consume' ? (
        <View
          style={styles.headerOverlay}
          pointerEvents={areControlsVisible ? 'box-none' : 'none'}
        >
          {areControlsVisible ? (
            <FileDetailScreenHeader
              file={file}
              title={file?.name ?? 'View'}
              navigation={navigation}
            />
          ) : null}
        </View>
      ) : null}

      {areControlsVisible ? (
        <FileDetailsControlBar
          viewStyle={viewStyle}
          setViewStyle={handleSetViewStyle}
          fileID={activeFileID}
        />
      ) : null}

      {isScreenReaderEnabled ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            areControlsVisible ? 'Hide controls' : 'Show controls'
          }
          accessibilityHint="Toggles navigation and actions"
          style={styles.accessibilityToggle}
          onPress={toggleControlsVisibility}
        >
          <View style={styles.accessibilityToggleInner}>
            <View style={styles.accessibilityToggleDot} />
          </View>
        </Pressable>
      ) : null}

      <FileActionsSheet
        navigation={navigation}
        sheetName="fileActions"
        fileID={activeFileID}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.gray[950], zIndex: 1 },
  pager: { flex: 1 },
  swipePage: { flex: 1 },
  consumeContainer: { flex: 1 },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  accessibilityToggle: {
    position: 'absolute',
    right: 12,
    top: '50%',
    marginTop: -16,
    zIndex: 3,
  },
  accessibilityToggleInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.gray[800],
    justifyContent: 'center',
    alignItems: 'center',
  },
  accessibilityToggleDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.gray[50],
  },
})

const normalizeIdentifier = (touch: NativeTouchEvent) =>
  touch.identifier != null
    ? String(touch.identifier)
    : `${touch.pageX}-${touch.pageY}`

function AutoDownload({
  file,
  children,
}: {
  file: FileRecord
  children: React.ReactNode
}) {
  useAutoDownload(file, detailsShouldAutoDownload)
  return children
}
