import { Linking, Platform } from 'react-native'
import InAppBrowser from 'react-native-inappbrowser-reborn'
import { palette } from '../styles/colors'

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
    await InAppBrowser.open(authURL, {
      dismissButtonStyle: 'done',
      preferredBarTintColor: palette.gray[950],
      preferredControlTintColor: 'white',
      modalPresentationStyle: 'fullScreen',
      modalTransitionStyle: 'coverVertical',
      modalEnabled: true,
      animated: true,
      showTitle: true,
      toolbarColor: palette.gray[950],
      navigationBarColor: palette.gray[950],
    })

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
