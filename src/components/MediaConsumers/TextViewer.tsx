import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, StyleSheet, ViewStyle, Platform } from 'react-native'
import { WebView } from 'react-native-webview'
import { readFileAsText } from '../../lib/readFileAsText'

export function TextViewer({
  uri,
  style,
  fileSize,
}: {
  uri: string
  style?: ViewStyle
  fileSize?: number | null
}) {
  const [text, setText] = useState('')

  const shouldUseWebView = fileSize == null ? true : fileSize > 256 * 1024 // ~256kb

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

  const html = useMemo(() => buildPreHtml(text), [text])

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

function buildPreHtml(s: string) {
  return `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:#000;color:#fff;font:14px/1.6 -apple-system,system-ui,Segoe UI,Roboto,Ubuntu}
  pre{white-space:pre-wrap;word-wrap:break-word;margin:0;padding:16px}
  code,pre,tt{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
</style>
<pre>${escapeHtml(s ?? '')}</pre>`
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
