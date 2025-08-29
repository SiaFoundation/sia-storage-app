import React, { StrictMode } from 'react'
import { View, StyleSheet } from 'react-native'
import HostSettings from './settings'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function App() {
  return (
    <StrictMode>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <HostSettings />
        </View>
      </SafeAreaView>
    </StrictMode>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f19', paddingTop: 0 },
  content: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1f2937',
    backgroundColor: '#0b1220',
  },
  tabButton: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 9999,
  },
  tabButtonActive: {
    backgroundColor: 'rgba(14,165,233,0.12)',
  },
  tabLabel: { color: '#9da7b3', fontWeight: '700' },
  tabLabelActive: { color: '#0ea5e9' },
})
