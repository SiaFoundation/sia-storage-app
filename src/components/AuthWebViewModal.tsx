import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { WebView, type WebViewNavigation } from 'react-native-webview'
import { useAuthWebViewStore } from '../stores/authWebView'
import { palette } from '../styles/colors'

export function AuthWebViewModal() {
  const webViewRef = useRef<WebView>(null)
  const [loading, setLoading] = useState(true)
  const { visible, url, close, callback } = useAuthWebViewStore()

  const handleNavigationStateChange = useCallback(
    (navState: WebViewNavigation) => {
      if (navState.url.startsWith('sia://')) {
        callback(navState.url)
      }
    },
    [callback],
  )

  const handleShouldStartLoadWithRequest = useCallback(
    (request: { url: string }) => {
      if (request.url.startsWith('sia://')) {
        callback(request.url)
        return false
      }
      return true
    },
    [callback],
  )

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={close}
            style={styles.cancelButton}
            testID="auth-webview-cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            Authorize
          </Text>
          <View style={styles.placeholder} />
        </View>

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={palette.gray[400]} />
          </View>
        )}

        <WebView
          ref={webViewRef}
          source={{ uri: url }}
          style={styles.webview}
          onNavigationStateChange={handleNavigationStateChange}
          onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          originWhitelist={['https://*', 'http://*', 'sia://*']}
          testID="auth-webview"
        />
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.gray[950],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.gray[800],
  },
  cancelButton: {
    paddingVertical: 4,
  },
  cancelText: {
    color: palette.gray[300],
    fontSize: 15,
  },
  title: {
    color: palette.gray[100],
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
    textAlign: 'center',
  },
  placeholder: {
    width: 50,
  },
  webview: {
    flex: 1,
    backgroundColor: palette.gray[950],
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: palette.gray[950],
    zIndex: 1,
  },
})
