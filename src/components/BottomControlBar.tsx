import React from 'react'
import { View, Pressable, StyleSheet, type ViewStyle, Text } from 'react-native'
import { colors, overlay, whiteA, palette } from '../styles/colors'

export type ControlIconButton = {
  id: string
  icon: React.ReactNode
  onPress: () => void
  disabled?: boolean
  label?: string
}

type Props = {
  width?: 'full' | 'dynamic'
  left?: ControlIconButton[]
  center?: ControlIconButton
  right?: ControlIconButton[]
  style?: ViewStyle
}

export function BottomControlBar({
  left = [],
  center,
  right = [],
  style,
  width = 'full',
}: Props) {
  return (
    <View style={[styles.wrap, style]} pointerEvents="box-none">
      <View
        style={[styles.bar, { width: width === 'dynamic' ? undefined : '90%' }]}
      >
        <View style={styles.sideRow}>
          {left.map((b) => (
            <Pressable
              key={b.id}
              accessibilityRole="button"
              onPress={b.onPress}
              disabled={b.disabled}
              style={[styles.iconButton, b.disabled && styles.disabled]}
            >
              {b.icon}
              {b.label ? <Text style={styles.label}>{b.label}</Text> : null}
            </Pressable>
          ))}
        </View>
        <View style={styles.centerWrap}>
          {center ? (
            <Pressable
              accessibilityRole="button"
              onPress={center.onPress}
              disabled={center.disabled}
              style={[styles.iconButton, center.disabled && styles.disabled]}
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
            <Pressable
              key={b.id}
              accessibilityRole="button"
              onPress={b.onPress}
              disabled={b.disabled}
              style={[styles.iconButton, b.disabled && styles.disabled]}
            >
              {b.icon}
              {b.label ? <Text style={styles.label}>{b.label}</Text> : null}
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 30,
    alignItems: 'center',
  },
  bar: {
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
  label: { fontSize: 10, color: colors.textMuted },
  disabled: { opacity: 0.3 },
})

export const iconColors = {
  active: colors.accentActive,
  inactive: whiteA.a70,
  white: palette.gray[50],
}
