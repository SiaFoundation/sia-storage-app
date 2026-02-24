import type React from 'react'
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import { overlay, palette, whiteA } from '../styles/colors'

export function Pill({
  selected = false,
  onPress,
  children,
  style,
}: {
  selected?: boolean
  onPress: () => void
  children: React.ReactNode
  style?: ViewStyle
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.pill,
        {
          backgroundColor: selected ? palette.blue[500] : overlay.panelMedium,
          borderColor: selected ? palette.blue[500] : whiteA.a10,
        },
        style,
      ]}
    >
      <View style={styles.content}>{children}</View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
})
