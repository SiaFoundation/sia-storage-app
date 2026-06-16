import { useIndexerURL } from '@siastorage/core/stores'
import { useCallback, useState } from 'react'
import { buildIndexerURL, stripProtocol } from '../lib/indexerURL'
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
  const storedIndexerURL = useIndexerURL()
  const toast = useToast()

  // The input holds only the host — the https:// protocol is locked in the UI.
  const rawInput = useInputValue({
    value: stripProtocol(storedIndexerURL.data ?? ''),
  })

  // Strip any protocol the user pastes so the field never duplicates https://.
  // rawInput.onChangeText is setState, stable across renders, so this wrapper
  // stays stable too — callers depend on it to reset the field without it
  // changing identity on every keystroke (which would re-clear as you type).
  const setInput = rawInput.onChangeText
  const onChangeText = useCallback((text: string) => setInput(stripProtocol(text)), [setInput])
  const newIndexerInputProps = { value: rawInput.value, onChangeText }

  // The full https URL to validate, auth against, and persist.
  const indexerURL = buildIndexerURL(rawInput.value)

  /**
   * Attempts connection to the selected indexer.
   * Returns result indicating whether already connected, needs mnemonic, or errored.
   */
  const connectToIndexer = useCallback(async (): Promise<ConnectResult> => {
    const newUrl = indexerURL
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
  }, [indexerURL, toast])

  return {
    newIndexerInputProps,
    connectToIndexer,
    indexerURL,
    isWaiting,
    hasErrored,
  }
}
