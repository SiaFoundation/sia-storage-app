import { appendLog } from './logAppender'
import { ANSI_BOLD, ANSI_RESET, getLevelColorAnsi, getScopeColorAnsi } from './logColors'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function getEnvVar(name: string): string | undefined {
  const proc = (globalThis as Record<string, unknown>).process as
    | { env: Record<string, string | undefined> }
    | undefined
  return proc?.env?.[name]
}

function getLogLevelFromEnv(): LogLevel {
  const level = getEnvVar('EXPO_PUBLIC_LOG_LEVEL')?.toLowerCase()
  if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
    return level
  }
  return 'debug'
}

function getScopeFilterFromEnv(): string[] | null {
  const filter = getEnvVar('EXPO_PUBLIC_LOG_SCOPES')
  if (filter) {
    return filter.split(',').map((s: string) => s.trim())
  }
  return null
}

function formatTimestamp(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  const millis = String(now.getMilliseconds()).padStart(3, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${millis}`
}

function shouldLogToTerminal(level: LogLevel, scope: string): boolean {
  const envLevel = getLogLevelFromEnv()
  const levelOrder: LogLevel[] = ['debug', 'info', 'warn', 'error']
  const envLevelIndex = levelOrder.indexOf(envLevel)
  const logLevelIndex = levelOrder.indexOf(level)

  if (logLevelIndex < envLevelIndex) {
    return false
  }

  const scopeFilter = getScopeFilterFromEnv()
  if (scopeFilter && scopeFilter.length > 0) {
    return scopeFilter.includes(scope)
  }

  return true
}

/** Serialize a data value for storage, converting Errors to plain objects. */
function serializeDataValue(value: unknown): unknown {
  if (value instanceof Error) {
    const obj: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    }
    if (value.stack) {
      obj.stack = value.stack.length > 500 ? `${value.stack.slice(0, 500)}...` : value.stack
    }
    for (const key of Object.keys(value)) {
      if (!['name', 'message', 'stack'].includes(key)) {
        obj[key] = (value as unknown as Record<string, unknown>)[key]
      }
    }
    return obj
  }
  return value
}

const MAX_STRING_VALUE_LENGTH = 2000

/** Serialize a data value for storage, truncating large strings. */
function truncateDataValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_STRING_VALUE_LENGTH) {
    return `${value.slice(0, MAX_STRING_VALUE_LENGTH)}...`
  }
  return value
}

/** Serialize data record for DB storage. Converts Error values to plain objects. */
export function serializeData(data: LogData | undefined): string | null {
  if (!data) return null
  const serialized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    serialized[key] = truncateDataValue(serializeDataValue(value))
  }
  try {
    return JSON.stringify(serialized)
  } catch {
    return null
  }
}

/** Format data as key=value pairs for terminal/display. */
export function formatDataPairs(data?: LogData): string {
  if (!data) return ''
  const pairs: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Error) {
      pairs.push(`${key}=${value.name}: ${value.message}`)
    } else if (typeof value === 'string') {
      pairs.push(`${key}=${value}`)
    } else if (value === null || value === undefined) {
      pairs.push(`${key}=${String(value)}`)
    } else {
      try {
        pairs.push(`${key}=${JSON.stringify(value)}`)
      } catch {
        pairs.push(`${key}=${String(value)}`)
      }
    }
  }
  return pairs.join(' ')
}

function formatTerminalLog(
  level: LogLevel,
  scope: string,
  timestamp: string,
  msg: string,
  data?: LogData,
): string {
  const levelColor = getLevelColorAnsi(level)
  const scopeColor = getScopeColorAnsi(scope)
  const levelUpper = level.toUpperCase().padEnd(5)
  const dataPart = formatDataPairs(data)
  const messagePart = dataPart ? `${msg} ${dataPart}` : msg
  return `${timestamp} ${levelColor}${ANSI_BOLD}${levelUpper}${ANSI_RESET} ${scopeColor}${ANSI_BOLD}[${scope}]${ANSI_RESET} ${messagePart}`
}

function createLogger(level: LogLevel) {
  return (scope: string, msg: string, data?: LogData) => {
    const timestamp = formatTimestamp()
    const entry: LogEntry = {
      timestamp,
      level,
      scope,
      message: msg,
      data,
    }

    appendLog(entry)

    if (shouldLogToTerminal(level, scope)) {
      console.log(formatTerminalLog(level, scope, timestamp, msg, data))
    }
  }
}

type ReservedLogKeys = 'ts' | 'level' | 'scope' | 'msg'

export type LogData = { [K in ReservedLogKeys]?: never } & {
  [key: string]: unknown
}

export type LogEntry = {
  timestamp: string
  level: LogLevel
  scope: string
  message: string
  data?: LogData
}

export const logger = {
  debug: createLogger('debug'),
  info: createLogger('info'),
  warn: createLogger('warn'),
  error: createLogger('error'),
  clear: () => {},
}

export const rustLogger = {
  hasInitialized: false,
  debug: (message: string) => {
    logger.debug('rust', message)
  },
  info: (message: string) => {
    logger.info('rust', message)
  },
  warn: (message: string) => {
    logger.warn('rust', message)
  },
  error: (message: string) => {
    logger.error('rust', message)
  },
}
