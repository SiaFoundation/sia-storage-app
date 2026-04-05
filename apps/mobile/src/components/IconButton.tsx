import type React from 'react'
import { Pressable, type StyleProp, StyleSheet, type ViewStyle } from 'react-native'
import { palette, whiteA } from '../styles/colors'

type Props = {
  onPress?: () => void
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  disabled?: boolean
  selected?: boolean
  size?: number
  accessibilityLabel?: string
  testID?: string
}

export function IconButton({
  onPress,
  children,
  style,
  disabled = false,
  selected = false,
  size = 36,
  accessibilityLabel,
  testID,
}: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      hitSlop={6}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        styles.ghost,
        selected && styles.selected,
        { width: size, height: size, borderRadius: 10 },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  selected: {
    backgroundColor: palette.gray[800],
  },
  pressed: {
    backgroundColor: whiteA.a08,
  },
  disabled: {
    opacity: 0.5,
  },
})
