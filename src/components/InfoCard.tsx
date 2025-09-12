import { type ReactNode } from 'react'
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native'

export function InfoCard({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  return <View style={[styles.card, style]}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
})
