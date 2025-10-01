import { Text, Pressable, StyleSheet, ViewStyle, StyleProp } from 'react-native'

export function Button({
  style,
  disabled,
  onPress,
  children,
  variant = 'primary',
}: {
  style?: StyleProp<ViewStyle>
  disabled?: boolean
  onPress: () => void
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
}) {
  return (
    <Pressable
      accessibilityRole="button"
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
    backgroundColor: '#0a84ff',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#fff',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.02)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dangerButton: {
    backgroundColor: '#c83532',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#ffffff', fontWeight: '700' },
  secondaryButtonText: { color: '#0a84ff', fontWeight: '700' },
  dangerButtonText: { color: '#ffffff', fontWeight: '700' },
  disabledButton: {
    opacity: 0.5,
  },
})
