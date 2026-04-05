import {
  formatDataPairs,
  getLevelColorHex,
  getScopeColorHex,
  type LogEntry,
} from '@siastorage/logger'
import { useCallback, useEffect, useRef } from 'react'
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useLogs } from '../hooks/useLogs'
import { palette } from '../styles/colors'

type LogViewProps = {
  isFollowing?: boolean
  onTotalCountChange?: (count: number) => void
  onScrollAwayFromBottom?: () => void
}

export function LogView({ isFollowing, onTotalCountChange, onScrollAwayFromBottom }: LogViewProps) {
  const { data, isLoading, error } = useLogs()
  const logs = data?.entries ?? []
  const totalCount = data?.totalCount ?? 0
  const flatListRef = useRef<FlatList<LogEntry>>(null)

  useEffect(() => {
    onTotalCountChange?.(totalCount)
  }, [totalCount, onTotalCountChange])

  const logCount = logs.length
  useEffect(() => {
    if (isFollowing && logCount > 0) {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false })
    }
  }, [isFollowing, logCount])

  const handleScrollBeginDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = event.nativeEvent.contentOffset.y
      if (offsetY > 10) {
        onScrollAwayFromBottom?.()
      }
    },
    [onScrollAwayFromBottom],
  )

  const renderLogItem = useCallback(({ item, index }: { item: LogEntry; index: number }) => {
    const scopeColor = getScopeColorHex(item.scope)
    const levelColor = getLevelColorHex(item.level) ?? palette.gray[50]
    const dataPart = formatDataPairs(item.data)

    return (
      <Text key={`${index}-${item.timestamp}-${item.scope}`} style={styles.line}>
        <Text style={[styles.timestamp, { color: palette.gray[400] }]}>{item.timestamp} </Text>
        <Text style={[styles.level, { color: levelColor }]}>{item.level.toUpperCase()} </Text>
        <Text style={[styles.scope, { color: scopeColor }]}>[{item.scope}] </Text>
        <Text style={styles.message}>{item.message}</Text>
        {dataPart ? <Text style={styles.data}>{` ${dataPart}`}</Text> : null}
      </Text>
    )
  }, [])

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
        ref={flatListRef}
        data={logs}
        renderItem={renderLogItem}
        keyExtractor={(item, index) => `${index}-${item.timestamp}-${item.scope}-${item.level}`}
        inverted
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator
        onScrollBeginDrag={handleScrollBeginDrag}
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
  data: {
    color: palette.gray[400],
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
