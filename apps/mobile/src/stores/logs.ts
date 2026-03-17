import { swrCacheBy } from '@siastorage/core/stores'
import {
  type LogEntry,
  type LogLevel,
  logger,
  serializeData,
  setLogAppender,
} from '@siastorage/logger'
import useSWR from 'swr'
import { app } from './appService'

const cache = swrCacheBy()
let logLevel: LogLevel = 'debug'
let logScopes: string[] = []

let hasInit = false

export async function initLogger(): Promise<void> {
  if (hasInit) {
    return
  }

  setLogAppender(appendLogToDb)
  logger.info('logs', 'init')

  const storedLevel = await getLogLevel()
  const storedScopes = await app().settings.getLogScopes()
  logLevel = storedLevel
  logScopes = storedScopes
  cache.invalidate('level')
  cache.invalidate('scopes')

  hasInit = true
}

export function useAvailableScopes() {
  return useSWR(cache.key('availableScopes'), () =>
    app().logs.availableScopes(),
  )
}

export function useLogLevel(): LogLevel {
  const { data } = useSWR(cache.key('level'), () => logLevel)
  return data ?? 'debug'
}

export function useLogScopes(): string[] {
  const { data } = useSWR(cache.key('scopes'), () => logScopes)
  return data ?? []
}

export function getLogLevelSync(): LogLevel {
  return logLevel
}

export function getLogScopesSync(): string[] {
  return logScopes
}

export async function getLogLevel(): Promise<LogLevel> {
  const stored = await app().settings.getLogLevel()
  if (
    stored === 'debug' ||
    stored === 'info' ||
    stored === 'warn' ||
    stored === 'error'
  ) {
    return stored
  }
  return 'debug'
}

export async function setLogLevel(value: LogLevel): Promise<void> {
  await app().settings.setLogLevel(value)
  logLevel = value
  cache.invalidate('level')
}

export async function setLogScopes(value: string[]): Promise<void> {
  await app().settings.setLogScopes(value)
  logScopes = value
  cache.invalidate('scopes')
}

export async function toggleLogScope(scope: string): Promise<void> {
  const current = await app().settings.getLogScopes()
  const newScopes = current.includes(scope)
    ? current.filter((s) => s !== scope)
    : [...current, scope]
  await setLogScopes(newScopes)
}

async function appendLogToDb(entry: LogEntry): Promise<void> {
  try {
    await app().logs.append({
      timestamp: entry.timestamp,
      level: entry.level,
      scope: entry.scope,
      message: entry.message,
      data: serializeData(entry.data),
    })
  } catch (error) {
    console.warn('[logs] Failed to append log:', error)
  }
}

function parseLogRow(row: {
  timestamp: string
  level: string
  scope: string
  message: string
  data: string | null
}): LogEntry {
  let data: Record<string, unknown> | undefined
  if (row.data) {
    try {
      data = JSON.parse(row.data)
    } catch {}
  }
  return {
    timestamp: row.timestamp,
    level: row.level as LogEntry['level'],
    scope: row.scope,
    message: row.message,
    data,
  }
}

export async function readLogs(
  logLevel?: LogLevel,
  logScopes?: string[],
  limit?: number,
): Promise<LogEntry[]> {
  try {
    const rows = await app().logs.read({ logLevel, logScopes, limit })
    return rows.map(parseLogRow)
  } catch (error) {
    console.error('[logs] Failed to read logs:', error)
    return []
  }
}

export async function countLogs(
  logLevel?: LogLevel,
  logScopes?: string[],
): Promise<number> {
  try {
    return await app().logs.count({ logLevel, logScopes })
  } catch (error) {
    console.error('[logs] Failed to count logs:', error)
    return 0
  }
}

export function extractScopes(entries: LogEntry[]): string[] {
  const scopes = new Set<string>()
  for (const entry of entries) {
    scopes.add(entry.scope)
  }
  return Array.from(scopes).sort()
}

export async function clearLogs(): Promise<void> {
  try {
    await app().logs.clear()
  } catch (error) {
    console.error('[logs] Failed to clear logs:', error)
    throw error
  }
}
