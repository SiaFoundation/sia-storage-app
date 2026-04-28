import { useEffect } from 'react'
import { BackHandler } from 'react-native'

// Close an overlay (e.g. FileCarousel) on Android back button press
// instead of letting React Navigation pop the screen.
export function useBackClose(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose()
      return true
    })
    return () => sub.remove()
  }, [isOpen, onClose])
}
