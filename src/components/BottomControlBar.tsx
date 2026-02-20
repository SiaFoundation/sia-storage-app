import type React from 'react'
import { useEffect, useState } from 'react'
import {
  Keyboard,
  type KeyboardEvent,
  Platform,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native'
import { colors, overlay, palette, whiteA } from '../styles/colors'
import { Gradient } from './Gradient'

type Props = {
  children?: React.ReactNode
  controlsTop?: React.ReactNode
  keyboardAware?: boolean
  style?: StyleProp<ViewStyle>
  variant?: 'pill' | 'floating'
}

export function BottomControlBar({
  style,
  children,
  controlsTop,
  keyboardAware = false,
  variant = 'pill',
}: Props) {
  const keyboardOffset = useKeyboardOffset(keyboardAware)

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View
        style={[
          styles.keyboardAwareContainer,
          { paddingBottom: 30 + keyboardOffset },
        ]}
      >
        <Gradient
          fadeTo="bottom"
          overlayTopColor={overlay.gradientLight}
          overlayBottomColor={overlay.gradientDark}
          style={[
            styles.gradient,
            {
              bottom: keyboardOffset,
              height: controlsTop ? 180 : 100,
            },
          ]}
        />
        <View
          style={[styles.contents, style]}
          pointerEvents={variant === 'floating' ? 'box-none' : 'auto'}
        >
          {controlsTop ? (
            <View style={styles.controlsTop}>{controlsTop}</View>
          ) : null}
          {variant === 'pill' ? (
            <View style={styles.bar}>{children}</View>
          ) : (
            children
          )}
        </View>
      </View>
    </View>
  )
}

export function FloatingPill({
  children,
  style,
}: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
}) {
  return <View style={[styles.floatingPill, style]}>{children}</View>
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    pointerEvents: 'box-none',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'column',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  keyboardAwareContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    alignSelf: 'stretch',
    width: '100%',
    pointerEvents: 'box-none',
  },
  gradient: {
    position: 'absolute',
    zIndex: 1,
    left: 0,
    right: 0,
  },
  contents: {
    flexDirection: 'row',
    zIndex: 2,
    width: '100%',
    flexShrink: 0,
  },
  bar: {
    flex: 1,
    flexShrink: 0,
    height: 56,
    borderRadius: 26,
    backgroundColor: overlay.panelStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    shadowColor: palette.gray[950],
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
    borderColor: whiteA.a08,
    borderWidth: StyleSheet.hairlineWidth,
  },
  controlsTop: {
    position: 'absolute',
    zIndex: 3,
    left: 0,
    right: 0,
    bottom: 56 + 12, // Bar height + gap.
    alignSelf: 'center',
    pointerEvents: 'box-none',
  },
  floatingPill: {
    height: 56,
    borderRadius: 26,
    backgroundColor: overlay.panelStrong,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    shadowColor: palette.gray[950],
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
    borderColor: whiteA.a08,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 10, color: colors.textMuted },
  disabled: { opacity: 0.3 },
})

export const iconColors = {
  active: colors.accentActive,
  inactive: whiteA.a70,
  white: palette.gray[50],
}

/** Returns the height of the keyboard when it is visible. */
function useKeyboardOffset(enabled: boolean) {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setOffset(0)
      return
    }

    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const handleShow = (event: KeyboardEvent) => {
      setOffset(event.endCoordinates?.height ?? 0)
    }
    const handleHide = () => {
      setOffset(0)
    }

    const showSub = Keyboard.addListener(showEvent, handleShow)
    const hideSub = Keyboard.addListener(hideEvent, handleHide)

    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [enabled])

  return offset
}
