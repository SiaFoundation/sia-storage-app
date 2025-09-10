import {
  Text,
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Pressable,
} from 'react-native'
import { useCallback } from 'react'
import { ChevronRightIcon } from 'lucide-react-native'
import useSWR from 'swr'
import { useSettings } from '../lib/settingsContext'

function Separator() {
  return <View style={styles.separator} />
}

function EmptyList() {
  return (
    <View style={styles.emptyBox}>
      <Text style={styles.emptyTitle}>No hosts yet</Text>
      <Text style={styles.emptyText}>Pull to refresh to try again.</Text>
    </View>
  )
}

export function Hosts({
  onSelectHost,
  hideHeader,
}: {
  onSelectHost?: (host: string) => void
  hideHeader?: boolean
}) {
  const { sdk } = useSettings()
  const {
    data: hosts,
    error,
    isLoading,
    isValidating,
    mutate,
  } = useSWR(sdk ? ['hosts', sdk] : null, async () => sdk.hosts())

  const refreshing = Boolean(hosts) && Boolean(isValidating)
  const handleRefresh = useCallback(() => {
    mutate()
  }, [mutate])

  return (
    <View style={styles.screen}>
      {hideHeader ? null : (
        <View style={styles.header}>
          <Text style={styles.title}>Hosts</Text>
          <Text style={styles.count}>
            {(hosts?.length ?? 0).toString()} total
          </Text>
        </View>
      )}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Failed to load hosts.</Text>
        </View>
      ) : null}

      {isLoading && !hosts ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#0ea5e9" />
        </View>
      ) : (
        <FlatList<string>
          data={hosts ?? []}
          keyExtractor={(item) => item}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              android_ripple={{ color: 'rgba(240,246,252,0.08)' }}
              onPress={() => onSelectHost?.(item)}
              style={({ pressed }) => [
                styles.row,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(item?.[0]?.toUpperCase() ?? '?') as string}
                </Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.host} numberOfLines={1}>
                  {item}
                </Text>
              </View>
              <ChevronRightIcon color="#57606a" size={18} />
            </Pressable>
          )}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={
            (hosts?.length ?? 0) === 0 ? styles.emptyContent : undefined
          }
          ListEmptyComponent={EmptyList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#8b949e"
            />
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f6f8fa',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderBottomColor: '#d0d7de',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#24292f',
  },
  count: {
    fontSize: 12,
    color: '#57606a',
  },
  list: {},
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
  chevron: {
    color: '#57606a',
    fontSize: 18,
    marginLeft: 8,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#d0d7de',
    marginLeft: 16 + 28 + 10, // Align under text, after avatar.
  },
  loading: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
  },
  errorText: {
    color: '#cf222e',
    fontSize: 12,
  },
  emptyContent: {
    paddingVertical: 28,
  },
  emptyBox: {
    alignItems: 'center',
    gap: 4,
  },
  emptyTitle: {
    color: '#24292f',
    fontWeight: '600',
  },
  emptyText: {
    color: '#57606a',
    fontSize: 12,
  },
})
