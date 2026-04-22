import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useAppStatus } from '../hooks/useAppStatus'
import { colors, palette } from '../styles/colors'

/**
 * Single-row, always-visible indicator of the app's current activity —
 * "Online and synced", "Syncing metadata from indexer", "No internet
 * connection", etc. Driven by the same `useAppStatus` hook as the
 * toolbar pill, so the two surfaces always agree on the current state.
 */
export function ActivityStatusRow() {
  const status = useAppStatus()
  if (!status.visible) return null

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.icon}>{status.icon}</View>
        <Text numberOfLines={1} style={styles.message}>
          {status.message}
          {status.animate ? <AnimatedEllipsis /> : null}
        </Text>
        {status.hint ? <Text style={styles.hint}>{status.hint}</Text> : null}
        {status.action ? (
          <Pressable onPress={status.action.onPress} hitSlop={8}>
            <Text style={styles.action}>{status.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

/**
 * Cycles through "", ".", "..", "..." every 500ms. Rendered as a regular
 * Text child so it stays inline with the preceding message without
 * wrapping onto a new line at the iOS baseline.
 */
function AnimatedEllipsis() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setCount((n) => (n + 1) % 4), 500)
    return () => clearInterval(id)
  }, [])
  return <Text>{'.'.repeat(count)}</Text>
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.bgPanel,
    borderRadius: 10,
  },
  icon: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    flex: 1,
    color: palette.gray[100],
    fontSize: 15,
  },
  hint: {
    color: palette.gray[400],
    fontSize: 13,
  },
  action: {
    color: palette.blue[400],
    fontSize: 14,
    fontWeight: '600',
  },
})
