import { useEffect, useRef } from 'react'
import { Linking } from 'react-native'

// Subscribe once on mount and route URL events through a ref so callers can
// pass inline closures without tearing down the subscription on every render.
// Re-subscribing per render races with incoming URL events and re-fires
// getInitialURL(), which on iOS keeps returning the launch URL and causes
// repeated navigations when state upstream changes.
export default function useLinkedURL(onUrl: (url: string) => void) {
  const onUrlRef = useRef(onUrl)
  onUrlRef.current = onUrl

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => onUrlRef.current(url))
    Linking.getInitialURL().then((u) => u && onUrlRef.current(u))
    return () => sub.remove()
  }, [])
}
