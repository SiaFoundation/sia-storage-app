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
    setIsWaiting(true)
    const isValid = validateURL(newUrl)
    if (!isValid) {
      toast.show('Invalid URL')
      setIsWaiting(false)
      return
    }
    const success = await onboardIndexer(newUrl)
    if (!success) {
      toast.show('Failed to connect')
      setHasErrored(true)
    } else {
      toast.show('Indexer connected')
      setIndexerURL(newUrl)
    }
    setIsWaiting(false)
  }, [newIndexerInputProps.value])

  return {
    newIndexerInputProps,
    saveAndOnboard,
    isWaiting,
    hasErrored,
  }
}
