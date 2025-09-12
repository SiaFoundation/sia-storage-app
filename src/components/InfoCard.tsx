import { type ReactNode } from 'react'
import { View, StyleSheet } from 'react-native'

export function InfoCard({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
})
