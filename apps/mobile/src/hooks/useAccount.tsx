import { logger } from '@siastorage/logger'
import useSWR from 'swr'
import { useSdk } from '../stores/sdk'

export function useAccount() {
  const sdk = useSdk()
  return useSWR(sdk ? [sdk, 'account'] : null, async ([sdk]) => {
    try {
      const account = await sdk.account()
      return account
    } catch (e) {
      logger.error('useAccount', 'error', { error: e as Error })
      throw e
    }
  })
}
