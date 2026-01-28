import useSWR from 'swr'
import { buildSWRHelpers } from '../lib/swr'
import { readLogs, useLogLevel, useLogScopes } from '../stores/logs'

export const logsSwr = buildSWRHelpers('logs')

export function useLogs() {
  const logLevel = useLogLevel()
  const logScopes = useLogScopes()

  return useSWR(
    logsSwr.getKey(`${logLevel},${logScopes.join(',')}`),
    () => readLogs(logLevel, logScopes),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  )
}
