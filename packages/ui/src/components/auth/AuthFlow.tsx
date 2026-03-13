import { hexToUint8 } from '@siastorage/core'
import type { SdkBuilder } from '@siastorage/core/stores'
import { logger } from '@siastorage/logger'
import { useEffect, useRef } from 'react'
import { useAuth } from '../../context/auth'
import { usePlatform } from '../../context/platform'
import { useAuthStore } from '../../stores/auth'
import { NonIdealState } from '../ui/NonIdealState'
import { ApproveScreen } from './ApproveScreen'
import { ConnectScreen } from './ConnectScreen'
import { LoadingScreen } from './LoadingScreen'
import { RecoveryScreen } from './RecoveryScreen'

async function checkOPFSSupport(): Promise<boolean> {
  try {
    await navigator.storage.getDirectory()
    return true
  } catch {
    return false
  }
}

export function AuthFlow() {
  const step = useAuthStore((s) => s.step)
  const error = useAuthStore((s) => s.error)
  const setError = useAuthStore((s) => s.setError)
  const auth = useAuth()
  const platform = usePlatform()
  const builderRef = useRef<SdkBuilder | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      const { storedKeyHex, indexerUrl, setStep } = useAuthStore.getState()
      try {
        logger.info('app', 'init_start')
        const opfsSupported = await checkOPFSSupport()
        if (!opfsSupported) {
          if (!cancelled) setStep('unsupported')
          return
        }
        if (auth.initSdk) {
          await auth.initSdk()
        }
        logger.info('app', 'init_ready')

        if (storedKeyHex && indexerUrl) {
          try {
            logger.info('app', 'reconnecting', { indexerUrl })
            const keyBytes = hexToUint8(storedKeyHex)
            const appKey = auth.createAppKey(keyBytes)
            const builder = auth.createBuilder(indexerUrl)
            const connected = await builder.connectWithKey(appKey)

            if (cancelled) return
            if (connected) {
              logger.info('app', 'connected')
              await auth.onConnected(storedKeyHex, indexerUrl)
              return
            }
          } catch (e) {
            if (cancelled) return
            logger.warn('app', 'reconnect_failed', { error: e as Error })
          }
        }

        if (!cancelled) {
          setStep('connect')
        }
      } catch (e) {
        if (!cancelled) {
          logger.error('app', 'init_error', { error: e as Error })
          setError(e instanceof Error ? e.message : 'An unknown error occurred')
          setStep('db-error')
        }
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [setError, auth])

  return (
    <>
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-900/90 border border-red-700 rounded-lg text-red-200 text-sm max-w-md text-center">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 text-red-400 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {step === 'loading' && <LoadingScreen />}
      {step === 'connect' && <ConnectScreen builder={builderRef} />}
      {step === 'approve' && <ApproveScreen builder={builderRef} />}
      {step === 'recovery' && <RecoveryScreen builder={builderRef} />}
      {step === 'unsupported' && (
        <div className="flex items-center justify-center min-h-screen p-6">
          <NonIdealState
            title="Browser Not Supported"
            description="This app requires a modern browser with Origin Private File System support. Private/incognito browsing modes are not supported."
          />
        </div>
      )}
      {step === 'db-error' && (
        <div className="flex items-center justify-center min-h-screen p-6">
          <NonIdealState
            title="Database Error"
            description={error || 'An unexpected database error occurred.'}
            action={{ label: 'Repair Database', onClick: platform.softReset }}
          />
        </div>
      )}

      <button
        type="button"
        onClick={platform.signOutAndReset}
        className="fixed bottom-4 right-4 px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-900/70 text-red-300 rounded-lg transition-colors"
      >
        Reset App
      </button>
    </>
  )
}
