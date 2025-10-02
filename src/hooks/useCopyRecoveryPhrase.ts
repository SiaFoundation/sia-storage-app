import { getRecoveryPhrase } from '../stores/settings'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'
import { useCallback } from 'react'

export function useCopyRecoveryPhrase() {
  const toast = useToast()
  return useCallback(async () => {
    const recoveryPhrase = await getRecoveryPhrase()
    Clipboard.setString(recoveryPhrase)
    toast.show('Copied recovery phrase')
  }, [toast])
}
