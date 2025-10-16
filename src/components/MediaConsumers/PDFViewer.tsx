import { StyleSheet, ViewStyle } from 'react-native'
import { WebView } from 'react-native-webview'
import { useMemo } from 'react'

export function PDFViewer({
  source,
  style,
}: {
  source: string
  style?: ViewStyle
}) {
  const allowingDir = useMemo(() => {
    if (!source.startsWith('file://')) return undefined
    return source.replace(/[^/]+$/, '')
  }, [source])

  return (
    <WebView
      style={[styles.webview, style]}
      originWhitelist={['*']}
      source={{ uri: source }}
      allowingReadAccessToURL={allowingDir}
    />
  )
}

const styles = StyleSheet.create({
  webview: { flex: 1 },
})
