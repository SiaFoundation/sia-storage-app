import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Sdk } from 'react-native-sia'
import { initFileDB } from '../functions/fileDB'
import * as SecureStore from 'expo-secure-store'
import { Linking } from 'react-native'
import { UploadedItem } from '../Upload'

const appSeed = new Uint8Array(32).fill(1)

type SettingsContextValue = {
  sdk: Sdk | null
  isConnected: boolean
  log: (message: string) => void
  indexerName: string
  setIndexerName: (value: string) => void
  indexerUrl: string
  setIndexerUrl: (value: string) => void
  isOnboarding: boolean
  setIsOnboarding: (value: boolean) => void
  uploads: UploadedItem[]
  setUploads: React.Dispatch<React.SetStateAction<UploadedItem[]>>
}

const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined
)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [indexerName, setIndexerName] = useState<string>('Test')
  const [indexerUrl, setIndexerUrl] = useState<string>(
    'https://app.indexd.zeus.sia.dev'
  )
  const [isOnboarding, setIsOnboardingState] = useState<boolean>(false)
  const [isConnected, setIsConnected] = useState<boolean>(false)

  const log = useCallback((message: string) => {
    console.log(message)
  }, [])

  const sdk = useMemo<Sdk>(() => new Sdk(indexerUrl, appSeed.buffer), [])

  useEffect(() => {
    ;(async () => {
      try {
        log('Connecting to app...')
        const isConnected = await sdk.connect()
        setIsConnected(isConnected)
        if (!isConnected) {
          const url = await sdk.requestAppConnection({
            name: 'Test',
            description: 'Test',
            serviceUrl: 'https://sia.storage',
            callbackUrl: 'siamobile://callback',
            logoUrl: 'https://sia.storage/logo.png',
          })

          // open url in browser
          Linking.openURL(url.responseUrl)

          const isAuthorized = await sdk.waitForConnect(url)
          if (!isAuthorized) {
            throw new Error('App not authorized')
          }
        }
        log('App connected')
      } catch (error) {
        log('Error creating app')
        log(error as string)
      }
    })()

    return () => {}
  }, [log, sdk])

  // Load persistent onboarding state once.
  useEffect(() => {
    ;(async () => {
      try {
        const stored = await SecureStore.getItemAsync('isOnboarding')
        if (stored == null) {
          setIsOnboardingState(false)
          return
        }
        setIsOnboardingState(stored === 'true')
      } catch {
        setIsOnboardingState(false)
      }
    })()
  }, [])

  const setIsOnboarding = useCallback((value: boolean) => {
    setIsOnboardingState(value)
    void SecureStore.setItemAsync('isOnboarding', value ? 'true' : 'false')
  }, [])

  useEffect(() => {
    ;(async () => {
      await initFileDB()
    })()
  }, [])

  const [uploads, setUploads] = useState<UploadedItem[]>([])

  const value = useMemo<SettingsContextValue>(
    () => ({
      sdk: sdk ?? null,
      isConnected,
      log,
      indexerName,
      setIndexerName,
      indexerUrl,
      setIndexerUrl,
      isOnboarding,
      setIsOnboarding,
      uploads,
      setUploads,
    }),
    [
      sdk,
      isConnected,
      log,
      indexerName,
      indexerUrl,
      isOnboarding,
      setIsOnboarding,
      uploads,
      setUploads,
    ]
  )

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('SettingsContext is not available.')
  return ctx
}
