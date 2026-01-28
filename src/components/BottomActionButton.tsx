import type React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, palette } from '../styles/colors'

type Props = {
  icon: React.ReactNode
  label: string
  onPress: () => void
  disabled?: boolean
}

export function BottomActionButton({ icon, label, onPress, disabled }: Props) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        disabled={disabled}
        style={[styles.button, disabled && styles.disabled]}
      >
        {icon}
        <Text style={styles.label}>{label}</Text>
      </Pressable>
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
  button: {
    flexDirection: 'row',
    gap: 8,
    height: 56,
    color: 'white',
    paddingHorizontal: 24,
    borderRadius: 28,
    backgroundColor: colors.accentPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: palette.gray[950],
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
  },
  label: { color: palette.gray[50], fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.5 },
})
