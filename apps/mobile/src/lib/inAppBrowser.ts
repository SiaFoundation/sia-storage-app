import { Linking } from 'react-native'
import InAppBrowser from 'react-native-inappbrowser-reborn'
import { palette } from '../styles/colors'

export const IN_APP_BROWSER_OPTIONS = {
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
} as const

/**
 * Opens a URL in the in-app browser, falling back to the system browser if the
 * in-app browser is unavailable or fails to open.
 *
 * Only web (http/https) URLs go through the in-app browser. InAppBrowser is a
 * web browser — on Android it launches a Chrome Custom Tab pinned to the default
 * browser package, which can't dispatch non-web schemes like mailto: or tel:.
 * Those are routed straight to Linking.openURL so the system resolves them to
 * the correct handler (e.g. the email app for mailto:).
 */
export async function openExternalURL(url: string): Promise<void> {
  if (/^https?:\/\//i.test(url)) {
    try {
      if (await InAppBrowser.isAvailable()) {
        await InAppBrowser.open(url, IN_APP_BROWSER_OPTIONS)
        return
      }
    } catch {
      // fall through to system browser
    }
  }
  await Linking.openURL(url)
}
