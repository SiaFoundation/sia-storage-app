import { StyleSheet, ViewStyle } from 'react-native'
import Pdf from 'react-native-pdf'
import { blackA } from '../../styles/colors'

export function PDFViewer({
  source,
  style,
}: {
  source: string
  style?: ViewStyle
}) {
  return (
    <Pdf
      fitPolicy={2}
      maxScale={8}
      minScale={1}
      source={{ uri: source }}
      style={[styles.pdf, style]}
      trustAllCerts={false}
      enableAntialiasing
    />
  )
}

const styles = StyleSheet.create({
  pdf: { flex: 1, backgroundColor: blackA['a20'] },
})
