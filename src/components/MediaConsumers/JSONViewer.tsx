import { useEffect, useState } from 'react'
import { ScrollView, Text, StyleSheet, ViewStyle, Platform } from 'react-native'
import { readFileAsText } from '../../lib/readFileAsText'

export function JSONViewer({ uri, style }: { uri: string; style?: ViewStyle }) {
  const [text, setText] = useState('')
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const openFile = async () => {
      try {
        const raw = await readFileAsText(uri)
        if (cancelled) return
        try {
          const obj = JSON.parse(raw)
          if (!cancelled) {
            setText(JSON.stringify(obj, null, 2))
            setNote(null)
          }
        } catch {
          if (!cancelled) {
            setText(raw ?? '')
            setNote('Invalid JSON — showing raw text')
          }
        }
      } catch {
        if (!cancelled) {
          setText('[Unable to load JSON]')
          setNote(null)
        }
      }
    }
    openFile()
    return () => {
      cancelled = true
    }
  }, [uri])

  return (
    <ScrollView style={style} contentContainerStyle={styles.content}>
      {note ? (
        <Text style={styles.note}>
          {note}
          {'\n'}
        </Text>
      ) : null}
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
  note: { color: 'orange', marginBottom: 8, fontSize: 12 },
})
