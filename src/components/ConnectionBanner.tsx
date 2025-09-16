import { StyleSheet, Text, View } from 'react-native'
import { useIsConnected, useIsInitializing } from '../stores/auth'
import { useHasOnboarded } from '../stores/auth'
import { TriangleAlertIcon } from 'lucide-react-native'

export default function ConnectionBanner() {
  const isInitializing = useIsInitializing()
  const isConnected = useIsConnected()
  const hasOnboarded = useHasOnboarded()
  if (isConnected || !hasOnboarded || isInitializing) return null
  return (
    <View style={styles.container}>
      <TriangleAlertIcon size={12} color="#A37A00" />
      <Text style={{ fontSize: 12 }}>
        Indexer connection lost. Offline mode.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: 24,
    backgroundColor: '#F5F5F5',

    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
})
