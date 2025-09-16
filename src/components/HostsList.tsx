import { Text, View, StyleSheet, Platform, Pressable } from 'react-native'
import { ChevronRightIcon } from 'lucide-react-native'
import useSWR from 'swr'
import { useSdk } from '../stores/auth'
import { SWRList } from './SWRList'

export function HostsList({
  onSelectHost,
}: {
  onSelectHost: (host: string) => void
}) {
  const sdk = useSdk()
  const response = useSWR(sdk ? ['hosts', sdk] : null, async () => sdk!.hosts())

  return (
    <SWRList
      response={response}
      keyField="publicKey"
      noDataMessage="No hosts yet"
      errorMessage="Failed to load hosts"
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          android_ripple={{ color: 'rgba(240,246,252,0.08)' }}
          onPress={() => onSelectHost(item.publicKey)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(item.publicKey?.toUpperCase() ?? '?') as string}
            </Text>
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.host} numberOfLines={1}>
              {item.publicKey}
            </Text>
          </View>
          <ChevronRightIcon color="#57606a" size={18} />
        </Pressable>
      )}
    />
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
  },
  rowPressed: {
    backgroundColor: '#f6f8fa',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0969da',
    marginRight: 10,
  },
  avatarText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  host: {
    color: '#24292f',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12,
  },
})
