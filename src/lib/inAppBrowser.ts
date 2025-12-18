import { Linking, Platform } from 'react-native'
import InAppBrowser from 'react-native-inappbrowser-reborn'
import { palette } from '../styles/colors'

export type InAppBrowserOptions<T = boolean> = {
  onResponseURL?: (url: string) => T
}

/**
 * Opens a URL in the in-app browser.
 * @param url - The URL to open.
 * @param options - Optional configuration for completion handling.
 * @returns Promise that resolves with the result of onResponseURL if a URL was received.
 */
export async function openInAppBrowser<T = boolean>(
  url: string,
  options?: InAppBrowserOptions<T>
): Promise<T | null> {
  if (await InAppBrowser.isAvailable()) {
    const { onResponseURL } = options || {}
    let result: T | null = null

    const subscription = Linking.addEventListener(
      'url',
      ({ url: received }) => {
        if (onResponseURL) {
          result = onResponseURL(received)
          InAppBrowser.close()
        }
      }
    )

    try {
      await InAppBrowser.open(url, {
        dismissButtonStyle: 'cancel',
        preferredBarTintColor: palette.slate[700],
        preferredControlTintColor: 'white',
        readerMode: false,
        animated: true,
        modalPresentationStyle: 'fullScreen',
        modalTransitionStyle: 'coverVertical',
        modalEnabled: true,
        enableBarCollapsing: false,
        showTitle: true,
        toolbarColor: palette.blue[500],
        secondaryToolbarColor: 'black',
        navigationBarColor: 'black',
        navigationBarDividerColor: 'white',
        enableUrlBarHiding: true,
        enableDefaultShare: true,
        forceCloseOnRedirection: false,
        animations: {
          startEnter: 'slide_in_right',
          startExit: 'slide_out_left',
          endEnter: 'slide_in_left',
          endExit: 'slide_out_right',
        },
      })

      // On Android, add a small delay to ensure Linking event is processed before returning.
      // This prevents a race condition where the browser closes before the listener fires.
      if (Platform.OS === 'android') {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      return result
    } finally {
      subscription.remove()
    }
  } else {
    await Linking.openURL(url)
    return null
  }
}
