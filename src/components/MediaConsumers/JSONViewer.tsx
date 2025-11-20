import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, StyleSheet, ViewStyle, Platform } from 'react-native'
import { WebView } from 'react-native-webview'
import { readFileAsText } from '../../lib/readFileAsText'

type Props = {
  uri: string
  style?: ViewStyle
  fileSize?: number | null
  topInset?: number
}

export function JSONViewer({ uri, style, fileSize, topInset }: Props) {
  const [text, setText] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const shouldUseWebView = fileSize == null ? true : fileSize > 256 * 1024 // ~256kb

  useEffect(() => {
    let cancelled = false
    const openFile = async () => {
      try {
        const raw = await readFileAsText(uri)
        if (cancelled) return

        if (shouldUseWebView) {
          if (!cancelled) {
            setText(raw ?? '')
            setNote(null)
          }
          return
        }

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
  }, [uri, shouldUseWebView])

  const html = useMemo(() => buildPreHtml(text, topInset), [text, topInset])

  const insetProps = topInset
    ? {
        contentInset: { top: topInset },
        contentOffset: { x: 0, y: -topInset },
        scrollIndicatorInsets: { top: topInset },
      }
    : null

  if (shouldUseWebView) {
    return (
      <WebView
        style={[{ flex: 1, backgroundColor: 'black' }, style]}
        originWhitelist={['*']}
        source={{ html }}
        onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:')}
      />
    )
  }

  return (
    <ScrollView
      style={style}
      contentContainerStyle={styles.content}
      {...(insetProps ?? {})}
    >
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

function buildPreHtml(s: string, topInset?: number) {
  const inset = topInset ?? 0
  const paddingTop = inset ? `padding-top:${inset}px;` : ''

  return `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:#000;color:#fff;font:14px/1.6 -apple-system,system-ui,Segoe UI,Roboto,Ubuntu}
  .wrap{padding:16px;${paddingTop}}
  pre{white-space:pre-wrap;word-wrap:break-word;margin:0;padding:16px}
  code,pre,tt{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
</style>
<div class="wrap"><pre>${escapeHtml(s ?? '')}</pre></div>`
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
