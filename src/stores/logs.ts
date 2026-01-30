import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { db, dbInitialized } from '../db'
import { sqlInsert } from '../db/sql'
import { setLogAppender } from '../lib/logAppender'
import { type LogEntry, type LogLevel, logger } from '../lib/logger'
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
  logger.info('logs', 'initLogger called')

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

// Get available scopes from log files.
export async function getAvailableScopes(): Promise<string[]> {
  const logs = await readLogs()
  return extractScopes(logs)
}

// Hook to get available scopes (reads from files).
export function useAvailableScopes(): string[] {
  const [scopes, setScopes] = useState<string[]>([])

  useEffect(() => {
    getAvailableScopes().then(setScopes)
  }, [])

  return scopes
}

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
      // Database not fully initialized (migrations not run), skip DB write.
      // Early logs still go to console via logger.ts.
      return
    }
    await sqlInsert('logs', {
      timestamp: entry.timestamp,
      level: entry.level,
      scope: entry.scope,
      message: entry.message,
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

/** Read logs from database with optional filters. */
export async function readLogs(
  logLevel?: LogLevel,
  logScopes?: string[],
): Promise<LogEntry[]> {
  try {
    if (!dbInitialized) {
      return []
    }
    const conditions: string[] = []
    const params: (string | number)[] = []

    // Filter by level.
    if (logLevel) {
      const allowedLevels = getLevelsForFilter(logLevel)
      const placeholders = allowedLevels.map(() => '?').join(',')
      conditions.push(`level IN (${placeholders})`)
      params.push(...allowedLevels)
    }

    // Filter by scope.
    if (logScopes && logScopes.length > 0) {
      const placeholders = logScopes.map(() => '?').join(',')
      conditions.push(`scope IN (${placeholders})`)
      params.push(...logScopes)
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const query = `SELECT timestamp, level, scope, message FROM logs ${whereClause} ORDER BY createdAt DESC, id DESC`

    const rows = await db().getAllAsync<{
      timestamp: string
      level: string
      scope: string
      message: string
    }>(query, ...params)

    return rows.map((row) => ({
      timestamp: row.timestamp,
      level: row.level as LogEntry['level'],
      scope: row.scope,
      message: row.message,
    }))
  } catch (error) {
    console.error('[logs] Failed to read logs:', error)
    return []
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
