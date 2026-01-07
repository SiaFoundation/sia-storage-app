import {
  Text,
  View,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ListRenderItem,
} from 'react-native'
import { colors, palette } from '../styles/colors'
import { useCallback, useState } from 'react'
import { SWRResponse } from 'swr'

export function SWRList<T>({
  keyField,
  response,
  renderItem,
  errorMessage,
  noDataMessage,
}: {
  response: SWRResponse<T[], any, any>
  keyField: keyof T
  renderItem: ListRenderItem<T>
  noDataMessage?: string
  errorMessage?: string
}) {
  const [refreshing, setRefreshing] = useState(false)
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await response.mutate()
    setRefreshing(false)
  }, [response.mutate])

  return (
    <View style={styles.screen}>
      {response.error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            {errorMessage ?? 'Failed to load data.'}
          </Text>
        </View>
      ) : null}
      {response.isLoading && !response.data ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.blue[400]} />
        </View>
      ) : (
        <FlatList<T>
          data={response.data ?? []}
          keyExtractor={(item) => item[keyField] as string}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={
            (response.data?.length ?? 0) === 0 ? styles.emptyContent : undefined
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>
                {noDataMessage ?? 'No data yet'}
              </Text>
              <Text style={styles.emptyText}>
                Pull to refresh to try again.
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={palette.gray[300]}
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
    backgroundColor: colors.bgCanvas,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
  },
  loading: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.bgPanel,
  },
  errorText: {
    color: palette.red[500],
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
    color: palette.gray[100],
    fontWeight: '600',
  },
  emptyText: {
    color: palette.gray[300],
    fontSize: 12,
  },
})
