import {
  type LogEntry,
  type LogLevel,
  logger,
  serializeData,
  setLogAppender,
} from '@siastorage/logger'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { db, dbInitialized } from '../db'
import { sqlInsert } from '../db/sql'
import { createGetterAndSWRHook } from '../lib/selectors'
import { getAsyncStorageString, setAsyncStorageString } from './asyncStore'

export type LogsState = {
  logLevel: LogLevel
  logScopes: string[]
}

export const useLogsStore = create<LogsState>(() => ({
  logLevel: 'debug',
  logScopes: [],
}))

const { setState } = useLogsStore

let hasInit = false

export async function initLogger(): Promise<void> {
  if (hasInit) {
    return
  }

  // Register the log appender to persist logs to the database.
  setLogAppender(appendLogToDb)

  // Now we can log.
  logger.info('logs', 'init')

  // Init state with stored values.
  const storedLevel = await getLogLevel()
  const storedScopes = await getLogScopes()
  setState((state) => {
    return {
      ...state,
      logLevel: storedLevel,
      logScopes: storedScopes,
    }
  })

  hasInit = true
}

async function fetchAvailableScopes(): Promise<string[]> {
  try {
    if (!dbInitialized) return []
    const rows = await db().getAllAsync<{ scope: string }>(
      'SELECT DISTINCT scope FROM logs ORDER BY scope',
    )
    return rows.map((r) => r.scope)
  } catch (error) {
    console.error('[logs] Failed to get scopes:', error)
    return []
  }
}

export const [getAvailableScopes, useAvailableScopes] =
  createGetterAndSWRHook<string[]>(fetchAvailableScopes)

export function useLogLevel(): LogLevel {
  return useLogsStore(useShallow((s) => s.logLevel))
}

export function useLogScopes(): string[] {
  return useLogsStore(useShallow((s) => s.logScopes))
}

// Get the log level from async storage.
export async function getLogLevel(): Promise<LogLevel> {
  const stored = await getAsyncStorageString('logLevel', 'debug')
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

// Set the log level in both async storage and store state.
export async function setLogLevel(value: LogLevel): Promise<void> {
  await setAsyncStorageString('logLevel', value)
  setState((state) => {
    return { ...state, logLevel: value }
  })
}

// Get the log scopes from async storage.
export async function getLogScopes(): Promise<string[]> {
  const stored = await getAsyncStorageString<string>('logScopes', '')
  if (!stored) {
    return []
  }
  return stored
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean)
}

// Set the log scopes in both async storage and store state.
export async function setLogScopes(value: string[]): Promise<void> {
  const valueStr = value.join(',')
  await setAsyncStorageString<string>('logScopes', valueStr)
  setState((state) => {
    return { ...state, logScopes: value }
  })
}

// Toggle a scope in the filter.
export async function toggleLogScope(scope: string): Promise<void> {
  const current = await getLogScopes()
  const newScopes = current.includes(scope)
    ? current.filter((s) => s !== scope)
    : [...current, scope]
  await setLogScopes(newScopes)
}

/** Append log entry directly to database (internal, registered as appender). */
async function appendLogToDb(entry: LogEntry): Promise<void> {
  try {
    if (!dbInitialized) {
      return
    }
    await sqlInsert('logs', {
      timestamp: entry.timestamp,
      level: entry.level,
      scope: entry.scope,
      message: entry.message,
      data: serializeData(entry.data),
      createdAt: Date.now(),
    })
  } catch (error) {
    console.error('[logs] Failed to append log:', error)
  }
}

/** Get levels that should be included based on minimum level. */
function getLevelsForFilter(minLevel: LogLevel): LogLevel[] {
  const levelOrder: LogLevel[] = ['debug', 'info', 'warn', 'error']
  const minIndex = levelOrder.indexOf(minLevel)
  return levelOrder.slice(minIndex)
}

/** Build WHERE clause and params for log queries. */
function buildLogFilterQuery(
  logLevel?: LogLevel,
  logScopes?: string[],
): { whereClause: string; params: (string | number)[] } {
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (logLevel) {
    const allowedLevels = getLevelsForFilter(logLevel)
    const placeholders = allowedLevels.map(() => '?').join(',')
    conditions.push(`level IN (${placeholders})`)
    params.push(...allowedLevels)
  }

  if (logScopes && logScopes.length > 0) {
    const placeholders = logScopes.map(() => '?').join(',')
    conditions.push(`scope IN (${placeholders})`)
    params.push(...logScopes)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return { whereClause, params }
}

/** Read logs from database with optional filters. */
export async function readLogs(
  logLevel?: LogLevel,
  logScopes?: string[],
  limit?: number,
): Promise<LogEntry[]> {
  try {
    if (!dbInitialized) {
      return []
    }

    const { whereClause, params } = buildLogFilterQuery(logLevel, logScopes)
    const limitClause = limit ? ` LIMIT ${limit}` : ''
    const query = `SELECT timestamp, level, scope, message, data FROM logs ${whereClause} ORDER BY createdAt DESC, id DESC${limitClause}`

    const rows = await db().getAllAsync<{
      timestamp: string
      level: string
      scope: string
      message: string
      data: string | null
    }>(query, ...params)

    return rows.map((row) => {
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
    })
  } catch (error) {
    console.error('[logs] Failed to read logs:', error)
    return []
  }
}

/** Count logs matching the current filters. */
export async function countLogs(
  logLevel?: LogLevel,
  logScopes?: string[],
): Promise<number> {
  try {
    if (!dbInitialized) {
      return 0
    }

    const { whereClause, params } = buildLogFilterQuery(logLevel, logScopes)
    const query = `SELECT COUNT(*) as count FROM logs ${whereClause}`
    const result = await db().getFirstAsync<{ count: number }>(query, ...params)
    return result?.count ?? 0
  } catch (error) {
    console.error('[logs] Failed to count logs:', error)
    return 0
  }
}

/** Extract unique scopes from entries. */
export function extractScopes(entries: LogEntry[]): string[] {
  const scopes = new Set<string>()
  for (const entry of entries) {
    scopes.add(entry.scope)
  }
  return Array.from(scopes).sort()
}

/** Clear all logs from the database. */
export async function clearLogs(): Promise<void> {
  try {
    if (!dbInitialized) {
      return
    }
    await db().runAsync('DELETE FROM logs')
  } catch (error) {
    console.error('[logs] Failed to clear logs:', error)
    throw error
  }
}
