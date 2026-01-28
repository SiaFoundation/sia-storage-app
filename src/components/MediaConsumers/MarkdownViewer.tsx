import MarkdownIt from 'markdown-it'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native'
import { WebView } from 'react-native-webview'
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes'
import { readFileAsText } from '../../lib/readFileAsText'
import BlocksLoader from '../BlocksLoader'

type Mode = 'preview' | 'raw'

export function MarkdownViewer({
  uri,
  style,
  onViewerControlPress,
}: {
  uri: string
  style?: ViewStyle
  onViewerControlPress?: () => void
}) {
  const [md, setMd] = useState('')
  const [mode, setMode] = useState<Mode>('preview')
  const [fileLoading, setFileLoading] = useState(true)
  const [webViewLoading, setWebViewLoading] = useState(true)

  const isLoading = fileLoading || webViewLoading

  const mdParser = useMemo(
    () =>
      new MarkdownIt({
        html: false,
        linkify: true,
        typographer: true,
        breaks: false,
      }),
    [],
  )

  useEffect(() => {
    let cancelled = false
    setFileLoading(true)
    setWebViewLoading(true)
    const openFile = async () => {
      try {
        const txt = await readFileAsText(uri)
        if (!cancelled) {
          setMd(txt ?? '')
          setFileLoading(false)
        }
      } catch {
        if (!cancelled) {
          setMd('[Unable to load markdown]')
          setFileLoading(false)
        }
      }
    }
    openFile()
    return () => {
      cancelled = true
    }
  }, [uri])

  const html = useMemo(() => {
    if (mode === 'raw') return buildRawHtml(md)
    const rendered = mdParser.render(md ?? '')
    return buildPreviewShell(rendered)
  }, [md, mode, mdParser])

  const handleShouldStart = useCallback(
    (req: ShouldStartLoadRequest): boolean => {
      const url = req?.url ?? ''
      if (url.startsWith('about:')) return true
      if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
        Linking.openURL(url).catch(() => {})
      }
      return false
    },
    [],
  )

  const setModeWithBlock = useCallback(
    (nextMode: Mode) => {
      onViewerControlPress?.()
      setMode(nextMode)
    },
    [onViewerControlPress],
  )

  return (
    <View style={[styles.container, style]}>
      <View style={styles.toolbar}>
        <Segment
          label="Preview"
          active={mode === 'preview'}
          onPress={() => setModeWithBlock('preview')}
        />
        <Segment
          label="Raw"
          active={mode === 'raw'}
          onPress={() => setModeWithBlock('raw')}
        />
      </View>

      <WebView
        style={[{ flex: 1, backgroundColor: 'black' }]}
        originWhitelist={['*']}
        source={{ html }}
        onLoadStart={() => setWebViewLoading(true)}
        onLoadEnd={() => setWebViewLoading(false)}
        onShouldStartLoadWithRequest={handleShouldStart}
      />

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <BlocksLoader size={20} />
          <Text style={styles.loadingText}>
            {fileLoading ? 'Reading file...' : 'Rendering...'}
          </Text>
        </View>
      )}
    </View>
  )
}

function Segment({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.segment, active && styles.segmentActive]}
    >
      <Text style={styles.segmentText}>{label}</Text>
    </Pressable>
  )
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildRawHtml(md: string) {
  return `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:#000;color:#fff;font:14px/1.6 -apple-system,system-ui,Segoe UI,Roboto,Ubuntu}
  .wrap{padding:16px;word-wrap:break-word}
  pre{white-space:pre-wrap}
  code,pre,tt{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
  a{color:#61dafb;text-decoration:none}
</style>
<div class="wrap"><pre>${escapeHtml(md)}</pre></div>`
}

function buildPreviewShell(innerHtml: string) {
  return `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:#000;color:#fff;font:14px/1.6 -apple-system,system-ui,Segoe UI,Roboto,Ubuntu}
  .wrap{padding:16px;word-wrap:break-word}
  .wrap h1,.wrap h2,.wrap h3{margin:1.2em 0 .6em}
  .wrap pre{background:#0b0b0b;border:1px solid #222;padding:12px;border-radius:8px;overflow:auto}
  .wrap code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
  .wrap a{color:#61dafb;text-decoration:none}
  .wrap table{border-collapse:collapse;border:1px solid #333}
  .wrap th,.wrap td{border:1px solid #333;padding:6px 8px}
  .wrap blockquote{border-left:3px solid #333;margin:0;padding:.5em 1em;color:#ddd}
  ul.task-list{list-style:none;padding-left:0}
</style>
<div class="wrap">${innerHtml}</div>`
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0b0b0b',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  segment: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#111',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#333',
  },
  segmentActive: {
    backgroundColor: '#222',
    borderColor: '#555',
  },
  segmentText: { color: 'white', fontSize: 13 },
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
