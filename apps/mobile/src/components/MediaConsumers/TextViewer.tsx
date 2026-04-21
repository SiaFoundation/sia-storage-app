import { useEffect, useMemo, useState } from 'react'
import { Platform, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { WebView } from 'react-native-webview'
import { readFileAsText } from '../../lib/readFileAsText'
import BlocksLoader from '../BlocksLoader'

type Props = {
  uri: string
  style?: ViewStyle
  fileSize?: number | null
  topInset?: number
}

export function TextViewer({ uri, style, fileSize, topInset }: Props) {
  const [text, setText] = useState('')
  const [fileLoading, setFileLoading] = useState(true)
  const [webViewLoading, setWebViewLoading] = useState(true)

  const shouldUseWebView = fileSize == null ? true : fileSize > 256 * 1024 // ~256kb
  const isLoading = fileLoading || (shouldUseWebView && webViewLoading)
  const isLargeFile = fileSize && fileSize > 5 * 1024 * 1024 // 5MB

  useEffect(() => {
    let cancelled = false
    setFileLoading(true)
    setWebViewLoading(true)
    const openFile = async () => {
      try {
        const data = await readFileAsText(uri)
        if (!cancelled) {
          setText(data ?? '')
          setFileLoading(false)
        }
      } catch {
        if (!cancelled) {
          setText('[Unable to load text]')
          setFileLoading(false)
        }
      }
    }
    openFile()
    return () => {
      cancelled = true
    }
  }, [uri])

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
      <View style={[{ flex: 1 }, style]}>
        <WebView
          style={{ flex: 1, backgroundColor: 'black' }}
          originWhitelist={['*']}
          source={{ html }}
          onLoadStart={() => setWebViewLoading(true)}
          onLoadEnd={() => setWebViewLoading(false)}
          onShouldStartLoadWithRequest={(req) => req.url.startsWith('about:')}
        />
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <BlocksLoader size={20} />
            <Text style={styles.loadingText}>
              {fileLoading
                ? isLargeFile
                  ? `Loading ${(fileSize / 1024 / 1024).toFixed(1)}MB file...`
                  : 'Reading file...'
                : 'Rendering...'}
            </Text>
          </View>
        )}
      </View>
    )
  }

  return (
    <ScrollView
      style={style}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      {...(insetProps ?? {})}
    >
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
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#fff',
    fontSize: 14,
  },
})

function buildPreHtml(s: string, topInset?: number) {
  const inset = topInset ?? 0
  const paddingTop = inset ? `padding-top:${inset}px;` : ''

  return `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:#000;color:#fff;font:14px/1.6 -apple-system,system-ui,Segoe UI,Roboto,Ubuntu}
  .wrap{padding:16px;${paddingTop}}
  pre{white-space:pre-wrap;word-wrap:break-word;margin:0;}
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
