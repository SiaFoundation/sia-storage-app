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
  variant?: 'primary' | 'secondary'
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={[
        styles.primaryButton,
        variant === 'secondary' && styles.secondaryButton,
        style,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text
        style={
          variant === 'secondary'
            ? styles.secondaryButtonText
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
  primaryButtonText: { color: '#ffffff', fontWeight: '700' },
  secondaryButtonText: { color: '#0a84ff', fontWeight: '700' },
})
