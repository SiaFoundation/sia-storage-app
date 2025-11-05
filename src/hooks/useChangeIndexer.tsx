import { useCallback, useState } from 'react'
import { useToast } from '../lib/toastContext'
import { setIndexerURL, useIndexerURL } from '../stores/settings'
import { useInputValue } from './useInputValue'
import { onboardIndexer } from '../stores/app'

function validateURL(url: string) {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export function useChangeIndexer() {
  const [isWaiting, setIsWaiting] = useState(false)
  const [hasErrored, setHasErrored] = useState(false)
  const indexerURL = useIndexerURL()
  const toast = useToast()

  const newIndexerInputProps = useInputValue({
    value: indexerURL.data ?? '',
  })

  const saveAndOnboard = useCallback(async () => {
    const newUrl = newIndexerInputProps.value
    setHasErrored(false)
    setIsWaiting(true)
    const isValid = validateURL(newUrl)
    if (!isValid) {
      toast.show('Invalid URL')
      setIsWaiting(false)
      return
    }
    const result = await onboardIndexer(newUrl)
    if (result === 'success') {
      toast.show('Indexer connected')
      setIndexerURL(newUrl)
    } else if (result === 'cancelled') {
      toast.show('Authorization cancelled')
    } else {
      toast.show('Failed to connect')
      setHasErrored(true)
    }
    setIsWaiting(false)
  }, [newIndexerInputProps.value, toast])

  return {
    newIndexerInputProps,
    saveAndOnboard,
    isWaiting,
    hasErrored,
  }
}
