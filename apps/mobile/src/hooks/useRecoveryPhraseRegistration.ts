import { logger } from '@siastorage/logger'
import { useCallback, useState } from 'react'
import { useToast } from '../lib/toastContext'
import { registerWithIndexer } from '../stores/sdk'

export function useRecoveryPhraseRegistration() {
  const toast = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const register = useCallback(
    async (
      phrase: string,
      indexerURL: string,
    ): Promise<{ success: boolean }> => {
      if (!phrase) {
        logger.warn('recoveryPhraseRegistration', 'no_phrase_available')
        return { success: false }
      }

      setIsSubmitting(true)
      const [, error] = await registerWithIndexer(phrase, indexerURL)
      setIsSubmitting(false)

      if (!error) {
        return { success: true }
      }

      logger.error('recoveryPhraseRegistration', 'registration_failed', {
        error: error as unknown as Error,
      })
      switch (error.type) {
        case 'cancelled':
          toast.show('Authorization cancelled')
          break
        case 'mnemonicMismatch':
          toast.show(
            'Recovery phrase does not match. Please enter the same recovery phrase you used before.',
          )
          break
        case 'error':
          toast.show(error.message)
          break
      }
      return { success: false }
    },
    [toast],
  )

  return {
    register,
    isSubmitting,
  }
}
