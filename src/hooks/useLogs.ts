import useSWR from 'swr'
import type { LogEntry } from '../lib/logger'
import { swrCacheBy } from '../lib/swr'
import { countLogs, readLogs, useLogLevel, useLogScopes } from '../stores/logs'

/** Filtered log entries, keyed by (level, scopes). */
export const logsCache = swrCacheBy()

export function useLogs() {
  const logLevel = useLogLevel()
  const logScopes = useLogScopes()

  return useSWR<{ entries: LogEntry[]; totalCount: number }>(
    logsCache.key(logLevel, logScopes.join(',')),
    async () => {
      const [entries, totalCount] = await Promise.all([
        readLogs(logLevel, logScopes, 500),
        countLogs(logLevel, logScopes),
      ])
      return { entries, totalCount }
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  )
}

/** Returns true if there are new logs available for the current filter. */
export function useHasNewLogs(lastFetchedCount: number): boolean {
  const logLevel = useLogLevel()
  const logScopes = useLogScopes()

  const { data: dbCount = 0 } = useSWR(
    ['logCount', logLevel, logScopes.join(',')],
    () => countLogs(logLevel, logScopes),
    {
      refreshInterval: 2000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  )

  return dbCount > lastFetchedCount
}
