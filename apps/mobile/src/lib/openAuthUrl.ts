import { Linking, Platform } from 'react-native'
import InAppBrowser from 'react-native-inappbrowser-reborn'
import { IN_APP_BROWSER_OPTIONS } from './inAppBrowser'

/**
 * Opens the auth URL in the system browser.
 *
 * Returns true if a `sia://` deep link is received (which also closes the
 * browser), and false otherwise (including when the browser is closed without
 * receiving a deep link or when InAppBrowser is unavailable).
 */
export async function openAuthURL(authURL: string): Promise<boolean> {
  if (!(await InAppBrowser.isAvailable())) {
    return false
  }

  let deepLinkReceived = false

  const subscription = Linking.addEventListener('url', ({ url }) => {
    if (url.startsWith('sia://')) {
      deepLinkReceived = true
      InAppBrowser.close()
    }
  })

  try {
    await InAppBrowser.open(authURL, IN_APP_BROWSER_OPTIONS)

    if (Platform.OS === 'android') {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    return deepLinkReceived
  } finally {
    subscription.remove()
  }
}

/**
 * Closes the auth browser programmatically (e.g. when polling confirms approval).
 */
export function closeAuthBrowser() {
  InAppBrowser.close()
}
