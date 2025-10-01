import { StyleSheet, Text, View } from 'react-native'
import { useIsConnected, useIsInitializing } from '../stores/auth'
import { useHasOnboarded } from '../stores/settings'
import { TriangleAlertIcon, UploadCloudIcon } from 'lucide-react-native'
import { useUploadScannerStatus } from '../managers/uploadScanner'

export function AppBanner() {
  const isInitializing = useIsInitializing()
  const isConnected = useIsConnected()
  const hasOnboarded = useHasOnboarded()
  const uploadsProgress = useUploadScannerStatus()
  if (!hasOnboarded || isInitializing) {
    return null
  }
  if (!isConnected) {
    return (
      <View style={styles.container}>
        <TriangleAlertIcon size={12} color="#A37A00" />
        <Text style={{ fontSize: 12 }}>
          Indexer connection lost. Offline mode.
        </Text>
      </View>
    )
  }
  if (uploadsProgress.enabled && uploadsProgress.localOnly > 0) {
    return (
      <View style={styles.container}>
        <UploadCloudIcon size={12} />
        <Text style={{ fontSize: 12 }}>
          Uploading files to network ({uploadsProgress.remaining}/
          {uploadsProgress.total})
        </Text>
      </View>
    )
  }
  return null
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
