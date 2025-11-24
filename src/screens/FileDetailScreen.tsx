import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  StyleSheet,
  FlatList,
  useWindowDimensions,
  type GestureResponderEvent,
  type NativeTouchEvent,
  AccessibilityInfo,
  Pressable,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'

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
  const { top: topInset } = useSafeAreaInsets()
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

  const flatListRef = useRef<FlatList<FileRecord>>(null)
  const hasAlignedInitialIndex = useRef(false)

  const initialTargetIndex = useMemo(
    () => files.findIndex((item) => item.id === route.params.id),
    [files, route.params.id]
  )
  const canPage = files.length > 0 && initialTargetIndex !== -1
  const initialIndex = initialTargetIndex === -1 ? 0 : initialTargetIndex

  const { handleEndReached } = useFlatListControls({
    data: fileList,
    size,
    setSize,
    isValidating,
    hasMore,
  })

  useEffect(() => {
    setActiveFileID(route.params.id)
    hasAlignedInitialIndex.current = false
  }, [route.params.id])

  useEffect(() => {
    if (!canPage || hasAlignedInitialIndex.current) return
    const index = initialIndex
    requestAnimationFrame(() => {
      try {
        flatListRef.current?.scrollToIndex({ index, animated: false })
      } catch (e) {
        // ignore until list is ready
      }
    })
    hasAlignedInitialIndex.current = true
  }, [canPage, initialIndex, route.params.id])

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

  const handleMomentumEnd = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      if (!files.length) return
      const index = Math.round(event.nativeEvent.contentOffset.x / width)
      const next = files[index]
      if (next && next.id !== activeFileID) {
        setActiveFileID(next.id)
      }
    },
    [files, width, activeFileID]
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

  const renderFileItem = useCallback(
    ({ item }: { item: FileRecord }) => {
      return (
        <AutoDownload file={item}>
          <View style={[styles.swipePage, { width }]}>
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
          </View>
        </AutoDownload>
      )
    },
    [navigation, renderConsumeView, viewStyle, width]
  )

  const flatListExtraData = useMemo(
    () => ({ viewStyle, areControlsVisible }),
    [areControlsVisible, viewStyle]
  )

  return (
    <View style={styles.container}>
      {canPage && file ? (
        <FlatList
          ref={flatListRef}
          horizontal
          pagingEnabled
          data={files}
          renderItem={renderFileItem}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          onMomentumScrollEnd={handleMomentumEnd}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.7}
          windowSize={3}
          extraData={flatListExtraData}
        />
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
