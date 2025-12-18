import { useMemo } from 'react'
import { validateRecoveryPhrase } from 'react-native-sia'
import { logger } from '../lib/logger'

export function useRecoveryPhraseValidation(manualPhrase: string) {
  const normalizedManualPhrase = useMemo(() => {
    const trimmed = manualPhrase.trim()
    if (!trimmed) {
      return ''
    }
    return trimmed.replace(/\s+/g, ' ').toLowerCase()
  }, [manualPhrase])

  const { isValid: isManualPhraseValid, error: manualValidationError } =
    useMemo(() => {
      if (!normalizedManualPhrase) {
        return { isValid: false, error: null as string | null }
      }

      try {
        validateRecoveryPhrase(normalizedManualPhrase)
        return { isValid: true, error: null }
      } catch (e) {
        if (__DEV__) logger.log('Recovery phrase validation failed:', e)

        const message =
          e instanceof Error
            ? e.message
            : typeof e === 'string'
            ? e
            : 'Invalid recovery phrase.'

        return { isValid: false, error: message }
      }
    }, [normalizedManualPhrase])

  return {
    normalizedManualPhrase,
    isManualPhraseValid,
    manualValidationError,
  }
}
