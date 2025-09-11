import { StyleSheet, Text, View } from 'react-native'
import { useSettings } from '../lib/settingsContext'
import { TriangleAlertIcon } from 'lucide-react-native'

export default function ConnectionBanner() {
  const { isConnected, isOnboarding } = useSettings()
  if (isConnected || isOnboarding) return null
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
