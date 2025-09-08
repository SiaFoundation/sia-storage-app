import { useEffect } from 'react'
import { Linking } from 'react-native'

// This hook listens for linked or referred URLs that interact with the app.
// Need to do a bit more testing on everywhere this applies (think it may run on dev URLs right now).
// But we accept a callback function to run on each received URL.
export default function useLinkedURL(onUrl: (url: string) => void) {
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => onUrl(url))
    Linking.getInitialURL().then((u) => u && onUrl(u))
    return () => sub.remove()
  }, [onUrl])
}
