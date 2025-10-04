import { Text, View, StyleSheet, ActivityIndicator } from 'react-native'
import { colors, palette } from '../styles/colors'
import { SWRResponse } from 'swr'

export function SWROverlay<T>({
  response,
  errorMessage,
  noDataMessage,
  children,
}: {
  response: SWRResponse<T, any, any>
  noDataMessage?: string
  errorMessage?: string
  children?: React.ReactNode
}) {
  return (
    <View style={styles.screen}>
      {response.error ? (
        <View style={styles.statusBar}>
          <Text style={styles.errorText}>
            {errorMessage ?? 'Failed to load data.'}
          </Text>
        </View>
      ) : null}
      {!response.isLoading && !response.data ? (
        <View style={styles.statusBar}>
          <Text style={styles.emptyText}>{noDataMessage ?? 'No data yet'}</Text>
        </View>
      ) : null}
      {response.isLoading && !response.data ? (
        <View style={styles.centeredBox}>
          <ActivityIndicator color={palette.blue[400]} />
        </View>
      ) : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.light[100],
  },
  loading: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBar: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
  },
  centeredBox: {
    zIndex: 1,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    color: palette.red[500],
    fontSize: 12,
  },
  emptyText: {
    color: palette.gray[975],
    fontWeight: '600',
  },
})
