import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Sdk } from 'react-native-sia'
import * as SecureStore from 'expo-secure-store'
import authApp from './authApp'
import * as SplashScreen from 'expo-splash-screen'
import { createSeed, loadSeed, storeSeed } from './seed'
import { logger } from './logger'

export type Logger = (...args: any[]) => void

type SettingsContextValue = {
  sdk: Sdk
  isConnected: boolean
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
  resetApp: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined
)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [appSeed, setAppSeedState] = useState<Uint8Array<ArrayBuffer>>(
    new Uint8Array(32).fill(35)
  )
  const [indexerName, setIndexerName] = useState<string>('Test')
  const [indexerURL, setIndexerURL] = useState<string>(
    'https://app.sia.storage'
  )
  const [sdk, setSdk] = useState<Sdk>(() => new Sdk(indexerURL, appSeed.buffer))
  const [isOnboarding, setIsOnboardingState] = useState<boolean | null>(null)
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const [isAuthing, setIsAuthing] = useState(false)

  const [logs, setLogs] = useState<string[]>([])
  const log = useCallback((...args: any[]) => {
    console.log(...args)
    setLogs((prev) => [
      ...prev.slice(-100),
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

  useEffect(() => {}, [])

  useEffect(() => {
    let splashTimeout: NodeJS.Timeout
    async function setOnboardingStatus() {
      // Do we have an app seed?
      try {
        let foundSeed = await loadSeed()
        if (!foundSeed) {
          // Something bigger needed here around
          // notification to user.
          foundSeed = createSeed()
        }
        setAppSeed(foundSeed)
      } catch {
        const newSeed = createSeed()
        await setAppSeed(newSeed)
      }

      // Are we onboarding?
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

  const setAppSeed = async (seed: Uint8Array<ArrayBuffer>) => {
    setAppSeedState(seed)
    await storeSeed(seed)
  }

  const setIsOnboarding = useCallback((value: boolean) => {
    setIsOnboardingState(value)
    void SecureStore.setItemAsync('isOnboarding', value ? 'true' : 'false')
  }, [])

  const resetApp = async () => {
    const newSeed = createSeed()
    await setAppSeed(newSeed)
    setIsOnboarding(true)
    setIsConnected(false)
  }

  useEffect(() => {
    // Don't run if we are in the middle of replacing the SDK.
    if (!sdk || isAuthing) return

    const connectSdk = async () => {
      const connected = await sdk.connect()
      if (!connected) setIsConnected(false)
      setIsConnected(true)
    }

    connectSdk()
  }, [sdk])

  const authIndexer = useCallback(
    async (nextIndexerURL?: string) => {
      setIsAuthing(true)
      const targetUrl = nextIndexerURL ?? indexerURL
      try {
        logger.log(
          `Creating candidate SDK for ${targetUrl} with ${appSeed.toString()} ...`
        )
        const candidate = new Sdk(targetUrl, appSeed.buffer)

        logger.log('Calling connect...')
        const connected = await candidate.connect()

        if (!connected) {
          logger.log('No connection. Requesting app connection...')
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

        logger.log('Connected. Promoting to active SDK.')
        setSdk(candidate)
        setIsConnected(true)
        if (nextIndexerURL && nextIndexerURL !== indexerURL)
          setIndexerURL(nextIndexerURL)
        setIsAuthing(false)
        return true
      } catch (err) {
        logger.log('Error connecting candidate SDK')
        logger.log(String(err))
        setIsAuthing(false)
        return false
      }
    },
    // Be careful about this dep array. Is it complete?
    [indexerURL, log, appSeed]
  )

  const value: SettingsContextValue = useMemo(
    () => ({
      sdk,
      isConnected,
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
      resetApp,
    }),
    [
      sdk,
      isConnected,
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
      resetApp,
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
