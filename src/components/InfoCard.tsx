import type { ReactNode } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { colors } from '../styles/colors'

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
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    borderColor: colors.borderSubtle,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
})
