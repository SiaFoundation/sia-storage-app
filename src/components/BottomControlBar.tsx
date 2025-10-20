import React from 'react'
import {
  View,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  StyleProp,
  ViewStyle,
} from 'react-native'
import { colors, overlay, whiteA, palette } from '../styles/colors'
import { Gradient } from './Gradient'

type Props = {
  children?: React.ReactNode
  overlayTop?: React.ReactNode
  keyboardAware?: boolean
  style?: StyleProp<ViewStyle>
}

export function BottomControlBar({
  style,
  children,
  overlayTop,
  keyboardAware = false,
}: Props) {
  return (
    <View style={styles.container} pointerEvents="box-none">
      <KeyboardAvoidingView
        enabled={keyboardAware}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        pointerEvents="box-none"
      >
        <View style={styles.wrapFlex} pointerEvents="box-none">
          <Gradient
            fadeTo="bottom"
            overlayTopColor={overlay.gradientLight}
            overlayBottomColor={overlay.gradientDark}
            style={{
              position: 'absolute',
              zIndex: 1,
              left: 0,
              right: 0,
              bottom: 0,
              height: overlayTop ? 320 : 150,
            }}
          />
          <View style={[styles.contents, style]}>
            {overlayTop ? (
              <View style={[styles.overlayTop]} pointerEvents="box-none">
                {overlayTop}
              </View>
            ) : null}
            <View style={styles.bar}>{children}</View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    pointerEvents: 'box-none',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contents: {
    flexDirection: 'row',
    zIndex: 2,
  },
  wrapFlex: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 30,
    width: '100%',
  },
  bar: {
    flex: 1,
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
  overlayTop: {
    position: 'absolute',
    zIndex: 3,
    left: 0,
    right: 0,
    bottom: 56 + 12, // Bar height + gap.
    alignSelf: 'center',
  },
  label: { fontSize: 10, color: colors.textMuted },
  disabled: { opacity: 0.3 },
})

export const iconColors = {
  active: colors.accentActive,
  inactive: whiteA.a70,
  white: palette.gray[50],
}
