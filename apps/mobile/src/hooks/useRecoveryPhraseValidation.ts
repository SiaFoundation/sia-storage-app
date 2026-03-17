import { logger } from '@siastorage/logger'
import { useEffect, useMemo, useState } from 'react'
import { app } from '../stores/appService'

export function useRecoveryPhraseValidation(manualPhrase: string) {
  const normalizedManualPhrase = useMemo(() => {
    const trimmed = manualPhrase.trim()
    if (!trimmed) {
      return ''
    }
    return trimmed.replace(/\s+/g, ' ').toLowerCase()
  }, [manualPhrase])

  const [isManualPhraseValid, setIsManualPhraseValid] = useState(false)
  const [manualValidationError, setManualValidationError] = useState<
    string | null
  >(null)

  useEffect(() => {
    if (!normalizedManualPhrase) {
      setIsManualPhraseValid(false)
      setManualValidationError(null)
      return
    }

    app()
      .auth.validateRecoveryPhrase(normalizedManualPhrase)
      .then(() => {
        setIsManualPhraseValid(true)
        setManualValidationError(null)
      })
      .catch((e) => {
        if (__DEV__)
          logger.debug('recoveryPhraseValidation', 'validation_failed', {
            error: e as Error,
          })

        const message =
          e instanceof Error
            ? e.message
            : typeof e === 'string'
              ? e
              : 'Invalid recovery phrase.'

        setIsManualPhraseValid(false)
        setManualValidationError(message)
      })
  }, [normalizedManualPhrase])

  return {
    normalizedManualPhrase,
    isManualPhraseValid,
    manualValidationError,
  }
}
