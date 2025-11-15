import { Platform, StyleSheet, ViewStyle } from 'react-native'
import { WebView } from 'react-native-webview'
import Pdf from 'react-native-pdf'
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

  const pdfSource = useMemo(
    () => ({
      uri: source,
    }),
    [source]
  )

  // The webview does not support PDF files on Android.
  if (Platform.OS === 'android') {
    return (
      <Pdf
        maxScale={4}
        minScale={1}
        spacing={8}
        enablePaging
        source={pdfSource}
        style={[styles.webview, style]}
        trustAllCerts={false}
        enableAntialiasing
      />
    )
  }

  // Continue using the webview on other platforms because its nicer to use.
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
