import useSWR from 'swr'
import { useSdk } from '../stores/sdk'
import { logger } from '../lib/logger'

export function useAccount() {
  const sdk = useSdk()
  return useSWR(sdk ? [sdk, 'account'] : null, async ([sdk]) => {
    try {
      const account = await sdk.account()
      return account
    } catch (e) {
      logger.error('useAccount', 'error getting account', e)
      throw e
    }
  })
}
