import type { Appender, LogEntry, LogLevel } from '../logger'
import { formatPlainLog, formatTerminalLog } from '../logger'

const LEVEL_ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error']

function getEnvVar(name: string): string | undefined {
  const proc = (globalThis as Record<string, unknown>).process as
    | { env: Record<string, string | undefined> }
    | undefined
  return proc?.env?.[name]
}

function readEnvLevel(): LogLevel | undefined {
  const level = getEnvVar('EXPO_PUBLIC_LOG_LEVEL')?.toLowerCase()
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    return level
  }
  return undefined
}

function readEnvScopes(): string[] | undefined {
  const filter = getEnvVar('EXPO_PUBLIC_LOG_SCOPES')
  if (!filter) return undefined
  const parts = filter
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : undefined
}

function meetsLevel(entry: LogLevel, threshold: LogLevel): boolean {
  return LEVEL_ORDER.indexOf(entry) >= LEVEL_ORDER.indexOf(threshold)
}

/**
 * Console appender. `level`/`scopes` fall back to `EXPO_PUBLIC_LOG_LEVEL` /
 * `EXPO_PUBLIC_LOG_SCOPES` (read once at factory time).
 */
export function createConsoleAppender(
  opts: {
    level?: LogLevel
    scopes?: string[]
    ansi?: boolean
  } = {},
): Appender {
  const level: LogLevel = opts.level ?? readEnvLevel() ?? 'debug'
  const scopes: string[] | undefined = opts.scopes ?? readEnvScopes()
  const ansi = opts.ansi ?? true
  const format = ansi ? formatTerminalLog : formatPlainLog

  return {
    write(entry: LogEntry) {
      if (!meetsLevel(entry.level, level)) return
      if (scopes && !scopes.includes(entry.scope)) return
      console.log(format(entry))
    },
  }
}
