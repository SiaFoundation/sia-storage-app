import { Linking } from 'react-native'
import InAppBrowser from 'react-native-inappbrowser-reborn'
import { palette } from '../styles/colors'

export default async function authApp(url: string): Promise<boolean> {
  if (await InAppBrowser.isAvailable()) {
    let completed = false
    const subscription = Linking.addEventListener(
      'url',
      ({ url: received }) => {
        if (received.startsWith('sia://')) {
          completed = true
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
      return completed
    } finally {
      subscription.remove()
    }
  } else {
    await Linking.openURL(url)
    return true
  }
}
