import React from 'react'
import {
  View,
  Pressable,
  StyleSheet,
  type ViewStyle,
  Text,
  Platform,
  KeyboardAvoidingView,
} from 'react-native'
import { colors, overlay, whiteA, palette } from '../styles/colors'
import { Gradient } from './Gradient'

export type ControlIconButton = {
  id: string
  icon: React.ReactNode
  onPress?: () => void
  disabled?: boolean
  label?: string
}

type Props = {
  width?: 'full' | 'dynamic'
  left?: ControlIconButton[]
  center?: ControlIconButton
  right?: ControlIconButton[]
  style?: ViewStyle
  content?: React.ReactNode
  overlayTop?: React.ReactNode
  keyboardAware?: boolean
}

export function BottomControlBar({
  left = [],
  center,
  right = [],
  style,
  width = 'full',
  content,
  overlayTop,
  keyboardAware = false,
}: Props) {
  return (
    <View style={styles.container} pointerEvents="box-none">
      <KeyboardAvoidingView
        enabled={keyboardAware}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
        pointerEvents="box-none"
      >
        <View style={[styles.wrapFlex, style]} pointerEvents="box-none">
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
          {overlayTop ? (
            <View
              style={[
                styles.overlayTop,
                { width: width === 'dynamic' ? undefined : '90%' },
              ]}
              pointerEvents="box-none"
            >
              <View style={styles.overlayInner}>{overlayTop}</View>
            </View>
          ) : null}
          <View
            style={[
              styles.bar,
              { width: width === 'dynamic' ? undefined : '90%' },
            ]}
          >
            {content ? (
              <View style={styles.fullContent}>{content}</View>
            ) : (
              <>
                <View style={styles.sideRow}>
                  {left.map((b) => (
                    <View key={b.id}>
                      {b.onPress ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={b.onPress}
                          disabled={b.disabled}
                          style={[
                            styles.iconButton,
                            b.disabled && styles.disabled,
                          ]}
                        >
                          {b.icon}
                          {b.label ? (
                            <Text style={styles.label}>{b.label}</Text>
                          ) : null}
                        </Pressable>
                      ) : (
                        // Render raw content if no onPress is provided.
                        <View style={styles.raw}>{b.icon}</View>
                      )}
                    </View>
                  ))}
                </View>
                <View style={styles.centerWrap}>
                  {center ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={center.onPress}
                      disabled={center.disabled}
                      style={[
                        styles.iconButton,
                        center.disabled && styles.disabled,
                      ]}
                    >
                      {center.icon}
                      {center.label ? (
                        <Text style={styles.label}>{center.label}</Text>
                      ) : null}
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.sideRow}>
                  {right.map((b) => (
                    <View key={b.id}>
                      {b.onPress ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={b.onPress}
                          disabled={b.disabled}
                          style={[
                            styles.iconButton,
                            b.disabled && styles.disabled,
                          ]}
                        >
                          {b.icon}
                          {b.label ? (
                            <Text style={styles.label}>{b.label}</Text>
                          ) : null}
                        </Pressable>
                      ) : (
                        <View style={styles.raw}>{b.icon}</View>
                      )}
                    </View>
                  ))}
                </View>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  kav: { flex: 1 },
  wrapFlex: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 30,
  },
  bar: {
    zIndex: 2,
    height: 56,
    maxWidth: 600,
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
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  centerWrap: { alignItems: 'center', justifyContent: 'center' },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
  },
  raw: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  overlayTop: {
    position: 'absolute',
    zIndex: 3,
    left: 0,
    right: 0,
    bottom: 56 + 12 + 30, // Bar height + gap + base padding.
    alignSelf: 'center',
    maxWidth: 600,
  },
  overlayInner: {
    flex: 1,
  },
  label: { fontSize: 10, color: colors.textMuted },
  disabled: { opacity: 0.3 },
})

export const iconColors = {
  active: colors.accentActive,
  inactive: whiteA.a70,
  white: palette.gray[50],
}
