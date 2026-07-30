import { Platform } from 'react-native'

/**
 * Screen headers are absolutely positioned so content scrolls under their
 * gradient, which leaves everything in normal flow starting at the top of the
 * screen. Offset by this to clear the header. Android's status bar makes it
 * taller.
 */
export const HEADER_CONTENT_OFFSET = Platform.OS === 'android' ? 150 : 130
