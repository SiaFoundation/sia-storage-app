import useSWR from 'swr'
import { readLogs, useLogLevel, useLogScopes } from '../stores/logs'
import { buildSWRHelpers } from '../lib/swr'

export const logsSwr = buildSWRHelpers('logs')

export function useLogs() {
  const logLevel = useLogLevel()
  const logScopes = useLogScopes()

  return useSWR(
    logsSwr.getKey(logLevel + ',' + logScopes.join(',')),
    () => readLogs(logLevel, logScopes),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  )
}
