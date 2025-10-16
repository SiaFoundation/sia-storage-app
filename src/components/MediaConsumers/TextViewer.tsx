import { useEffect, useState } from 'react'
import { ScrollView, Text, StyleSheet, ViewStyle, Platform } from 'react-native'
import { readFileAsText } from '../../lib/readFileAsText'

export function TextViewer({ uri, style }: { uri: string; style?: ViewStyle }) {
  const [text, setText] = useState('')

  useEffect(() => {
    let cancelled = false
    const openFile = async () => {
      try {
        const data = await readFileAsText(uri)
        if (!cancelled) setText(data ?? '')
      } catch {
        if (!cancelled) setText('[Unable to load text]')
      }
    }
    openFile()
    return () => {
      cancelled = true
    }
  }, [uri])

  return (
    <ScrollView style={style} contentContainerStyle={styles.content}>
      <Text selectable style={styles.mono}>
        {text}
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  mono: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 14,
    color: 'white',
  },
})
