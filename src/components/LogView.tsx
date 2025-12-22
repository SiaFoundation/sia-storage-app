import { useRef, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { palette } from '../styles/colors'
import { type LogEntry } from '../lib/logger'
import { getScopeColorHex, getLevelColorHex } from '../lib/logColors'
import { useLogs } from '../hooks/useLogs'

export function LogView() {
  const { data: logs = [], isLoading, error } = useLogs()

  const renderLogItem = useCallback(
    ({ item, index }: { item: LogEntry; index: number }) => {
      const scopeColor = getScopeColorHex(item.scope)
      const levelColor = getLevelColorHex(item.level) ?? palette.gray[50]

      return (
        <Text
          key={`${index}-${item.timestamp}-${item.scope}`}
          style={styles.line}
        >
          <Text style={[styles.timestamp, { color: palette.gray[400] }]}>
            {item.timestamp}{' '}
          </Text>
          <Text style={[styles.level, { color: levelColor }]}>
            {item.level.toUpperCase()}{' '}
          </Text>
          <Text style={[styles.scope, { color: scopeColor }]}>
            [{item.scope}]{' '}
          </Text>
          <Text style={styles.message}>{item.message}</Text>
        </Text>
      )
    },
    []
  )

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={palette.gray[400]} />
        <Text style={styles.loadingText}>Loading logs...</Text>
      </View>
    )
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>Failed to load logs</Text>
      </View>
    )
  }

  if (logs.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>No logs yet.</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={logs}
        renderItem={renderLogItem}
        keyExtractor={(item, index) =>
          `${index}-${item.timestamp}-${item.scope}-${item.level}`
        }
        inverted
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0, paddingBottom: 85 },
  content: { padding: 12 },
  line: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
  },
  timestamp: {},
  level: {
    fontWeight: '600',
  },
  scope: {
    fontWeight: '600',
  },
  message: {
    color: palette.gray[50],
  },
  empty: {
    color: palette.gray[300],
    textAlign: 'center',
    marginTop: 40,
  },
  loadingText: {
    color: palette.gray[400],
    textAlign: 'center',
    marginTop: 12,
  },
})
