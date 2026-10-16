import { Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/** The height of a screen header's own content, below the top safe area, on iOS. */
const IOS_HEADER_HEIGHT = 68

/**
 * Screen headers are absolutely positioned so content scrolls under their
 * gradient, which leaves everything in normal flow starting at the top of the
 * screen. Offset by this to clear the header. On iOS the header sits below the
 * top safe area, which runs from 0 on an iPhone Duo's cover screen, whose
 * status bar is down the side, to 62 under a Dynamic Island. Android's status
 * bar makes its header taller.
 */
export function useHeaderContentOffset(): number {
  const insets = useSafeAreaInsets()
  return Platform.OS === 'android' ? 150 : insets.top + IOS_HEADER_HEIGHT
}
