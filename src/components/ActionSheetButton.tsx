import { Pressable, StyleSheet, Text } from 'react-native'
import { colors, palette } from '../styles/colors'

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
  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="button"
      style={styles.container}
      onPress={onPress}
    >
      <Text style={iconStyle}>{icon}</Text>
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
    color: colors.accentPrimary,
  },
  primaryIcon: {
    color: colors.accentPrimary,
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
