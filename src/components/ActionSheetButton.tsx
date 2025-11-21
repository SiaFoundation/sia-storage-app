import { cloneElement, isValidElement, type ReactElement } from 'react'
import { Pressable, StyleProp, StyleSheet, Text, TextStyle } from 'react-native'
import { palette } from '../styles/colors'

export function ActionSheetButton({
  disabled,
  onPress,
  children,
  icon,
  variant = 'primary',
}: {
  disabled?: boolean
  onPress: () => void
  children: React.ReactNode
  variant?: 'primary' | 'danger'
  icon: React.ReactNode
}) {
  const textStyle = disabled
    ? styles.disabledText
    : variant === 'primary'
    ? styles.primaryText
    : styles.dangerText
  const iconStyle = disabled
    ? styles.disabledIcon
    : variant === 'primary'
    ? styles.primaryIcon
    : styles.dangerIcon
  const renderedIcon = isValidElement(icon)
    ? cloneElement(icon as ReactElement<{ style?: StyleProp<TextStyle> }>, {
        style: iconStyle,
      })
    : icon
  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="button"
      style={styles.container}
      onPress={onPress}
    >
      <Text style={iconStyle}>{renderedIcon}</Text>
      <Text style={textStyle}>{children}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 10,
  },
  primaryText: {
    fontSize: 16,
    color: palette.gray[100],
  },
  primaryIcon: {
    color: palette.gray[100],
  },
  dangerText: {
    fontSize: 16,
    color: palette.red[500],
  },
  dangerIcon: {
    color: palette.red[500],
  },
  disabledText: {
    fontSize: 16,
    opacity: 0.3,
  },
  disabledIcon: {
    opacity: 0.3,
  },
})
