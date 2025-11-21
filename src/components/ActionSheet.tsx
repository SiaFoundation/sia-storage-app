import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LayoutChangeEvent,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native'
import {
  BottomSheetBackdrop,
  BottomSheetModal as GorhomBottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
  type BottomSheetModal,
  BottomSheetView,
} from '@gorhom/bottom-sheet'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { palette } from '../styles/colors'

const styles = StyleSheet.create({
  background: {
    backgroundColor: palette.gray[800],
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: palette.gray[950],
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  content: {
    paddingTop: 12,
    paddingHorizontal: 16,
    gap: 6,
  },
  handle: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  handleIndicator: {
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: palette.gray[600],
  },
})

const flattenedHandleStyle = StyleSheet.flatten(styles.handle) ?? {}
const flattenedIndicatorStyle = StyleSheet.flatten(styles.handleIndicator) ?? {}

const HANDLE_EXTRA_HEIGHT =
  Number(flattenedHandleStyle.paddingTop ?? 0) +
  Number(flattenedHandleStyle.paddingBottom ?? 0) +
  Number(flattenedIndicatorStyle.height ?? 0)

const SNAP_POINT_TOLERANCE = 6
const DEFAULT_SNAP_POINTS: Array<number | string> = ['44%', '82%']

type Props = {
  visible: boolean
  onRequestClose: () => void
  children: React.ReactNode
  contentStyle?: StyleProp<ViewStyle>
  backdropOpacity?: number
  snapPoints?: Array<number | string>
  initialSnapIndex?: number
  enableContentPanningGesture?: boolean
}

export function ActionSheet({
  visible,
  onRequestClose,
  children,
  contentStyle,
  backdropOpacity = 0.35,
  snapPoints,
  initialSnapIndex,
  enableContentPanningGesture = true,
}: Props) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const bottomSheetRef = useRef<BottomSheetModal>(null)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const [currentIndex, setCurrentIndex] = useState<number>(-1)

  const contentPaddingBottom = useMemo(() => {
    return Math.max(16, insets.bottom + 12)
  }, [insets.bottom])

  const availableHeight = useMemo(() => {
    return Math.max(windowHeight - Math.max(insets.top, 0), 1)
  }, [insets.top, windowHeight])

  // Calculate the snap points and the initial snap index.
  const { snapHeights, resolvedInitialIndex } = useMemo(() => {
    const configuredHeights = calculateConfiguredHeights(
      snapPoints,
      availableHeight
    )

    const totalContentHeight =
      contentHeight !== null ? contentHeight + HANDLE_EXTRA_HEIGHT : null

    const finalSnapHeights = buildFinalSnapHeights(
      configuredHeights,
      totalContentHeight,
      availableHeight
    )

    const initialIndex = resolveInitialSnapIndex(
      initialSnapIndex,
      finalSnapHeights,
      totalContentHeight
    )

    return {
      snapHeights: finalSnapHeights,
      resolvedInitialIndex: initialIndex,
    }
  }, [availableHeight, contentHeight, initialSnapIndex, snapPoints])

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        pressBehavior="close"
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={backdropOpacity}
      />
    ),
    [backdropOpacity]
  )

  const contentContainerStyle = useMemo<ViewStyle>(() => {
    const extra = StyleSheet.flatten(contentStyle) ?? {}
    return {
      ...styles.content,
      paddingBottom: contentPaddingBottom,
      ...extra,
    }
  }, [contentPaddingBottom, contentStyle])

  // Enable scrolling only when at full screen and content still overflows.
  const shouldEnableScroll = useMemo(() => {
    if (contentHeight === null || snapHeights.length === 0) return false

    const totalContentHeight = contentHeight + HANDLE_EXTRA_HEIGHT
    const clampedIndex = clampIndex(currentIndex, snapHeights.length - 1)
    const atFullScreen = isAtFullScreenHeight(
      snapHeights[clampedIndex],
      availableHeight
    )

    return atFullScreen && totalContentHeight > availableHeight
  }, [availableHeight, contentHeight, currentIndex, snapHeights])

  const handleDismiss = useCallback(() => {
    onRequestClose()
    setCurrentIndex(-1)
  }, [onRequestClose])

  const handleSheetChange = useCallback((index: number) => {
    setCurrentIndex(index)
  }, [])

  // Present the sheet when it becomes visible.
  useEffect(() => {
    const sheet = bottomSheetRef.current
    if (!sheet || !visible) return

    sheet.present()
    if (resolvedInitialIndex >= 0) {
      sheet.snapToIndex(resolvedInitialIndex)
    }
  }, [resolvedInitialIndex, visible])

  // Dismiss the sheet when it becomes hidden.
  useEffect(() => {
    const sheet = bottomSheetRef.current
    if (!sheet || visible) return

    sheet.dismiss()
  }, [visible])

  // Update the current index when the sheet becomes visible or hidden.
  useEffect(() => {
    setCurrentIndex(visible ? resolvedInitialIndex : -1)
  }, [resolvedInitialIndex, visible])

  // Measure the content height and update the state.
  const handleContentLayout = useCallback((event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout
    setContentHeight((prev) => {
      if (prev === null) return height
      return Math.abs(prev - height) <= 1 ? prev : height
    })
  }, [])

  return (
    <GorhomBottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapHeights}
      index={resolvedInitialIndex}
      handleStyle={styles.handle}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.background}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      enableContentPanningGesture={enableContentPanningGesture}
      keyboardBehavior="interactive"
      onDismiss={handleDismiss}
      onChange={handleSheetChange}
      overDragResistanceFactor={4.5}
    >
      {shouldEnableScroll ? (
        <BottomSheetScrollView
          contentContainerStyle={contentContainerStyle}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View onLayout={handleContentLayout}>{children}</View>
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView
          onLayout={handleContentLayout}
          style={contentContainerStyle}
        >
          {children}
        </BottomSheetView>
      )}
    </GorhomBottomSheetModal>
  )
}

/**
 * Convert a snap point from percentages or pixels to pixels.
 */
function convertSnapPointToPixels(
  point: number | string,
  availableHeight: number
): number | null {
  if (typeof point === 'number' && Number.isFinite(point)) {
    return Math.min(point, availableHeight)
  }
  if (typeof point === 'string') {
    const value = Number.parseFloat(point)
    if (Number.isFinite(value)) {
      return Math.min((value / 100) * availableHeight, availableHeight)
    }
  }
  return null
}

/**
 * Convert the configured snap points from percentages or pixels to pixels.
 */
function calculateConfiguredHeights(
  snapPoints: Array<number | string> | undefined,
  availableHeight: number
): number[] {
  const rawPoints =
    snapPoints && snapPoints.length > 0 ? snapPoints : DEFAULT_SNAP_POINTS
  return rawPoints
    .map((point) => convertSnapPointToPixels(point, availableHeight))
    .filter((h): h is number => h !== null && h > 0)
    .sort((a, b) => a - b)
}

/**
 * Build the final snap heights which includes:
 * - the configured snap points
 * - the total content height
 * If any two snap heights are within the tolerance,
 * they will be merged into a single snap height.
 */
function buildFinalSnapHeights(
  configuredHeights: number[],
  totalContentHeight: number | null,
  availableHeight: number
): number[] {
  if (totalContentHeight === null) {
    return configuredHeights.length > 0
      ? configuredHeights
      : [availableHeight * 0.5]
  }

  const maxHeight = Math.min(totalContentHeight, availableHeight)
  const allowedHeights = configuredHeights.filter(
    (h) => h <= maxHeight + SNAP_POINT_TOLERANCE
  )

  const snapSet = new Set(allowedHeights)
  const isDuplicate = allowedHeights.some(
    (h) => Math.abs(h - maxHeight) <= SNAP_POINT_TOLERANCE
  )
  if (!isDuplicate || allowedHeights.length === 0) {
    snapSet.add(maxHeight)
  }

  return Array.from(snapSet).sort((a, b) => a - b)
}

/**
 * Resolve the initial snap index based on the initial snap index prop,
 * the final snap heights, and the total content height.
 */
function resolveInitialSnapIndex(
  initialSnapIndex: number | undefined,
  finalSnapHeights: number[],
  totalContentHeight: number | null
): number {
  if (
    typeof initialSnapIndex === 'number' &&
    initialSnapIndex >= 0 &&
    initialSnapIndex < finalSnapHeights.length
  ) {
    return initialSnapIndex
  }

  if (
    totalContentHeight !== null &&
    totalContentHeight <= finalSnapHeights[0] + SNAP_POINT_TOLERANCE
  ) {
    const naturalIndex = finalSnapHeights.findIndex(
      (h) => Math.abs(h - totalContentHeight) <= SNAP_POINT_TOLERANCE
    )
    if (naturalIndex >= 0) {
      return naturalIndex
    }
  }

  return 0
}

function clampIndex(index: number, maxIndex: number): number {
  return Math.max(0, Math.min(index, maxIndex))
}

function isAtFullScreenHeight(
  snapHeight: number,
  availableHeight: number
): boolean {
  return Math.abs(snapHeight - availableHeight) <= SNAP_POINT_TOLERANCE
}
