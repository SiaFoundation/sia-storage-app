import { Pressable, type StyleProp, StyleSheet, Text, type ViewStyle } from 'react-native'
import { colors, palette, whiteA } from '../styles/colors'

export function Button({
  style,
  disabled,
  onPress,
  children,
  variant = 'primary',
  accessibilityLabel,
  testID,
}: {
  style?: StyleProp<ViewStyle>
  disabled?: boolean
  onPress: () => void
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
  accessibilityLabel?: string
  testID?: string
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.primaryButton,
        variant === 'danger' && styles.dangerButton,
        variant === 'secondary' && styles.secondaryButton,
        disabled && styles.disabledButton,
        style,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text
        style={
          variant === 'secondary'
            ? styles.secondaryButtonText
            : variant === 'danger'
              ? styles.dangerButtonText
              : styles.primaryButtonText
        }
      >
        {children}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  primaryButton: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: colors.bgElevated,
    boxShadow: `0 0 0 1px ${whiteA.a02}`,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  dangerButton: {
    backgroundColor: palette.red[500],
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  primaryButtonText: { color: palette.gray[50], fontWeight: '700' },
  secondaryButtonText: { color: palette.blue[400], fontWeight: '700' },
  dangerButtonText: { color: palette.gray[50], fontWeight: '700' },
  disabledButton: {
    opacity: 0.5,
  },
})
