import { useIndexerURL } from '@siastorage/core/stores'
import { useCallback, useState } from 'react'
import { useToast } from '../lib/toastContext'
import { authenticateIndexer } from '../stores/sdk'
import { useInputValue } from './useInputValue'

function validateURL(url: string) {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export type ConnectResult =
  | { status: 'connected' }
  | { status: 'needsMnemonic' }
  | { status: 'error' }

/**
 * Hook for onboarding indexer selection.
 * Used by SwitchIndexerScreen to manage indexer input and auth flow.
 */
export function useChangeIndexer() {
  const [isWaiting, setIsWaiting] = useState(false)
  const [hasErrored, setHasErrored] = useState(false)
  const indexerURL = useIndexerURL()
  const toast = useToast()

  const newIndexerInputProps = useInputValue({
    value: indexerURL.data ?? '',
  })

  /**
   * Attempts connection to the selected indexer.
   * Returns result indicating whether already connected, needs mnemonic, or errored.
   */
  const connectToIndexer = useCallback(async (): Promise<ConnectResult> => {
    const newUrl = newIndexerInputProps.value
    setHasErrored(false)
    setIsWaiting(true)
    const isValid = validateURL(newUrl)
    if (!isValid) {
      toast.show('Invalid URL')
      setIsWaiting(false)
      setHasErrored(true)
      return { status: 'error' }
    }
    const [result, error] = await authenticateIndexer(newUrl)
    setIsWaiting(false)
    if (error) {
      if (error.type === 'cancelled') {
        toast.show('Authorization cancelled')
      } else {
        toast.show(error.message)
      }
      setHasErrored(true)
      return { status: 'error' }
    }
    if (result.alreadyConnected) {
      return { status: 'connected' }
    }
    return { status: 'needsMnemonic' }
  }, [newIndexerInputProps.value, toast])

  return {
    newIndexerInputProps,
    connectToIndexer,
    isWaiting,
    hasErrored,
  }
}
