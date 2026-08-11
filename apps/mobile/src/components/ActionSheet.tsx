import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  type BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetModal as GorhomBottomSheetModal,
} from '@gorhom/bottom-sheet'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type StyleProp, StyleSheet, useWindowDimensions, type ViewStyle } from 'react-native'
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

type Props = {
  visible: boolean
  onRequestClose: () => void
  children: React.ReactNode
  contentStyle?: StyleProp<ViewStyle>
  backdropOpacity?: number
}

export function ActionSheet({
  visible,
  onRequestClose,
  children,
  contentStyle,
  backdropOpacity = 0.35,
}: Props) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const bottomSheetRef = useRef<BottomSheetModal>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (visible) {
      setMounted(true)
    } else if (mounted) {
      bottomSheetRef.current?.dismiss()
    }
  }, [visible, mounted])

  // Present once the sheet is mounted. Dynamic sizing measures the content and
  // opens the sheet at exactly that height in one pass — no manual snap points.
  useEffect(() => {
    if (!mounted) return
    bottomSheetRef.current?.present()
  }, [mounted])

  // Cap the dynamic height so a long list can't grow past the usable screen;
  // beyond this the content scrolls instead.
  const maxDynamicContentSize = useMemo(() => {
    return Math.max(windowHeight - Math.max(insets.top, 0), 1)
  }, [insets.top, windowHeight])

  const contentContainerStyle = useMemo<ViewStyle>(() => {
    const extra = StyleSheet.flatten(contentStyle) ?? {}
    return {
      ...styles.content,
      paddingBottom: Math.max(16, insets.bottom + 12),
      ...extra,
    }
  }, [insets.bottom, contentStyle])

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
    [backdropOpacity],
  )

  const handleDismiss = useCallback(() => {
    onRequestClose()
    setMounted(false)
  }, [onRequestClose])

  if (!mounted) return null

  return (
    <GorhomBottomSheetModal
      ref={bottomSheetRef}
      enableDynamicSizing
      maxDynamicContentSize={maxDynamicContentSize}
      handleStyle={styles.handle}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.background}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      onDismiss={handleDismiss}
      overDragResistanceFactor={4.5}
    >
      <BottomSheetScrollView
        contentContainerStyle={contentContainerStyle}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </BottomSheetScrollView>
    </GorhomBottomSheetModal>
  )
}
