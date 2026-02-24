import { logger } from '@siastorage/logger'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { colors, palette, whiteA } from '../styles/colors'

const MAX_DETAIL_LENGTH = 2000

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

// Error boundaries require class components — there is no hook equivalent.
// https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('errorBoundary', 'uncaught_render_error', {
      error,
      componentStack: info.componentStack ?? undefined,
    })
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const detail = `${error.message}\n\n${error.stack ?? ''}`.slice(
      0,
      MAX_DETAIL_LENGTH,
    )

    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
          <View style={styles.content}>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.subtitle}>
              The app encountered an unexpected error.
            </Text>
            <ScrollView
              style={styles.detailScroll}
              contentContainerStyle={styles.detailContent}
            >
              <Text style={styles.detailText} selectable>
                {detail}
              </Text>
            </ScrollView>
            <Pressable
              style={styles.button}
              onPress={this.handleRetry}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    )
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  content: {
    maxWidth: 400,
    maxHeight: '80%',
    width: '100%',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: palette.gray[100],
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: whiteA.a70,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 4,
  },
  detailScroll: {
    maxHeight: 300,
    width: '100%',
    backgroundColor: palette.gray[900],
    borderRadius: 8,
  },
  detailContent: {
    padding: 12,
  },
  detailText: {
    color: palette.gray[400],
    fontSize: 12,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: {
    color: palette.gray[50],
    fontWeight: '700',
  },
})
