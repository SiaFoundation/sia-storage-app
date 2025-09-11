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
import * as SecureStore from 'expo-secure-store'
import authApp from '../functions/authApp'
import * as SplashScreen from 'expo-splash-screen'

export type Logger = (...args: any[]) => void

export const logger = {
  log: (...args: any[]) => {},
  clear: () => {},
}

type SettingsContextValue = {
  sdk: Sdk
  isConnected: boolean
  log: Logger
  logs: string[]
  clearLogs: () => void
  indexerName: string
  setIndexerName: (value: string) => void
  indexerURL: string
  setIndexerURL: (value: string) => void
  isOnboarding: boolean | null
  setIsOnboarding: (value: boolean) => void
  authIndexer: (nextIndexerURL?: string) => Promise<boolean>
  appSeed: Uint8Array<ArrayBuffer>
  setAppSeed: (value: Uint8Array<ArrayBuffer>) => void
}

const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined
)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [appSeed, setAppSeed] = useState<Uint8Array<ArrayBuffer>>(
    new Uint8Array(32).fill(30)
  )
  const [indexerName, setIndexerName] = useState<string>('Test')
  const [indexerURL, setIndexerURL] = useState<string>(
    'https://app.indexd.zeus.sia.dev'
  )
  const [sdk, setSdk] = useState<Sdk>(() => new Sdk(indexerURL, appSeed.buffer))
  const [isOnboarding, setIsOnboardingState] = useState<boolean | null>(null)
  const [isConnected, setIsConnected] = useState<boolean>(false)

  const [logs, setLogs] = useState<string[]>([])
  const log = useCallback((...args: any[]) => {
    console.log(args.join(' '))
    setLogs((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString()} ${args.join(' ')}`,
    ])
  }, [])

  const clearLogs = useCallback(() => {
    setLogs([])
  }, [])

  useEffect(() => {
    logger.log = log
    logger.clear = clearLogs
  }, [log, clearLogs])

  useEffect(() => {
    let splashTimeout: NodeJS.Timeout
    async function setOnboardingStatus() {
      try {
        const foundOnboarding = await SecureStore.getItemAsync('isOnboarding') // "true" | "false" | null
        if (foundOnboarding === 'true' || foundOnboarding === null) {
          setIsOnboardingState(true)
        } else {
          setIsOnboardingState(false)
        }
      } catch {
        setIsOnboardingState(true)
      }
      // Waiting on state update to unhide splashscreen.
      splashTimeout = setTimeout(() => {
        SplashScreen.hideAsync()
      }, 200)
    }

    setOnboardingStatus()

    return () => clearTimeout(splashTimeout)
  }, [])

  const setIsOnboarding = useCallback((value: boolean) => {
    setIsOnboardingState(value)
    void SecureStore.setItemAsync('isOnboarding', value ? 'true' : 'false')
  }, [])

  useEffect(() => {
    if (!sdk) return

    const connectSdk = async () => {
      const connected = await sdk.connect()
      if (connected) setIsConnected(true)
    }

    connectSdk()
  }, [sdk])

  const authIndexer = useCallback(
    async (nextIndexerURL?: string) => {
      const targetUrl = nextIndexerURL ?? indexerURL
      try {
        log(`Creating candidate SDK for ${targetUrl} ...`)
        const candidate = new Sdk(targetUrl, appSeed.buffer)

        log('Calling connect...')
        const connected = await candidate.connect()

        if (!connected) {
          log('No connection. Requesting app connection...')
          const url = await candidate.requestAppConnection({
            name: 'Test',
            description: 'Test',
            serviceUrl: 'https://sia.storage',
            callbackUrl: 'siamobile://callback',
            logoUrl: 'https://sia.storage/logo.png',
          })

          authApp(url.responseUrl)

          const authorized = await candidate.waitForConnect(url)
          if (!authorized) throw new Error('App not authorized')
        }

        log('Connected. Promoting to active SDK.')
        setSdk(candidate)
        setIsConnected(true)
        if (nextIndexerURL && nextIndexerURL !== indexerURL)
          setIndexerURL(nextIndexerURL)
        return true
      } catch (err) {
        log('Error connecting candidate SDK')
        log(String(err))
        return false
      }
    },
    [indexerURL, log]
  )

  const value: SettingsContextValue = useMemo(
    () => ({
      sdk,
      isConnected,
      log,
      indexerName,
      setIndexerName,
      indexerURL,
      setIndexerURL,
      isOnboarding,
      setIsOnboarding,
      authIndexer,
      logs,
      clearLogs,
      appSeed,
      setAppSeed,
    }),
    [
      sdk,
      isConnected,
      log,
      indexerName,
      setIndexerName,
      indexerURL,
      setIndexerURL,
      isOnboarding,
      setIsOnboarding,
      authIndexer,
      logs,
      clearLogs,
      appSeed,
      setAppSeed,
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
