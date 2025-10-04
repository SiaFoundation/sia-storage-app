import { useRef } from 'react'
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native'
import { palette } from '../styles/colors'

export function LogView({ logs }: { logs: string[] }) {
  const scrollRef = useRef<any>(null)

  const handleContentSizeChange = (_w: number, _h: number) => {
    scrollRef.current?.scrollToEnd?.({ animated: true })
  }

  return (
    <View style={styles.container}>
      <ScrollView
        ref={(node) => {
          scrollRef.current = node
        }}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator
        onContentSizeChange={handleContentSizeChange}
      >
        {logs.length === 0 ? (
          <Text style={styles.empty}>No logs yet.</Text>
        ) : (
          logs.map((l, i) => (
            <Text key={`${i}-${l.slice(0, 10)}`} style={styles.line}>
              {l}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  scroll: { flex: 1 },
  content: { padding: 12 },
  line: {
    color: palette.gray[50],
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
  },
  empty: {
    color: palette.gray[300],
    textAlign: 'center',
    marginTop: 40,
  },
})
