import { Text, Pressable, StyleSheet, ViewStyle, StyleProp } from 'react-native'

export function Button({
  style,
  disabled,
  onPress,
  children,
}: {
  style?: StyleProp<ViewStyle>
  disabled?: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.primaryButton, style]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.primaryButtonText}>{children}</Text>
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
  primaryButtonText: { color: '#ffffff', fontWeight: '700' },
})
