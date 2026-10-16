import type { RefObject } from 'react'
import { useCallback } from 'react'
import { Platform, type TextInputInstance } from 'react-native'

export function useFocusOnShow(ref: RefObject<TextInputInstance | null>) {
  return useCallback(() => {
    if (Platform.OS === 'android') {
      // On Android, Modal.onShow fires before content is fully laid out,
      // so focus() is a no-op without a short delay.
      setTimeout(() => ref.current?.focus(), 100)
    } else {
      ref.current?.focus()
    }
  }, [ref])
}
