import { appendLog } from './logAppender'
import {
  ANSI_BOLD,
  ANSI_RESET,
  getLevelColorAnsi,
  getScopeColorAnsi,
} from './logColors'

// Log levels in order of severity.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// Parse log level from env var.
function getLogLevelFromEnv(): LogLevel {
  if (typeof process !== 'undefined' && process.env) {
    const level = process.env.EXPO_PUBLIC_LOG_LEVEL?.toLowerCase()
    if (
      level === 'debug' ||
      level === 'info' ||
      level === 'warn' ||
      level === 'error'
    ) {
      return level
    }
  }
  return 'debug' // Default to debug in dev.
}

/** Parse scope filter from env var (comma-separated). */
function getScopeFilterFromEnv(): string[] | null {
  if (typeof process !== 'undefined' && process.env) {
    const filter = process.env.EXPO_PUBLIC_LOG_SCOPES
    if (filter) {
      return filter.split(',').map((s: string) => s.trim())
    }
  }
  return null
}

/** Serialize a value to a string, converting objects/errors to JSON. */
function serializeValue(value: unknown): string {
  // Handle primitives.
  if (value === null || value === undefined) {
    return String(value)
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }

  // Handle Error objects specially to capture message, stack, and other properties.
  if (value instanceof Error) {
    const errorObj: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    }
    // Truncate stack trace to prevent extremely long log messages.
    if (value.stack) {
      const stack = value.stack
      // Limit stack trace to first 500 characters to prevent UI issues.
      errorObj.stack = stack.length > 500 ? `${stack.slice(0, 500)}...` : stack
    }
    // Include any additional properties on the error.
    Object.keys(value).forEach((key) => {
      if (!['name', 'message', 'stack'].includes(key)) {
        errorObj[key] = (value as unknown as Record<string, unknown>)[key]
      }
    })
    try {
      const json = JSON.stringify(errorObj)
      // Also limit total JSON size to prevent issues.
      return json.length > 1000 ? `${json.slice(0, 1000)}...` : json
    } catch {
      return `Error: ${value.name} - ${value.message}`
    }
  }

  // Handle objects and arrays - serialize to one-line JSON.
  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value)
      // Limit total JSON size to prevent extremely long log messages.
      return json.length > 1000 ? `${json.slice(0, 1000)}...` : json
    } catch {
      // If JSON.stringify fails (circular reference, etc.), fall back to string representation.
      return String(value)
    }
  }

  // Fallback for anything else.
  return String(value)
}

/** Format timestamp with full date and time for better log analysis.
 * Format: "2026-01-05 07:56:03.123" (ISO-like, local time)
 */
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

/** Check if a log should be output to terminal based on level and scope filters. */
function shouldLogToTerminal(level: LogLevel, scope: string): boolean {
  const envLevel = getLogLevelFromEnv()
  const levelOrder: LogLevel[] = ['debug', 'info', 'warn', 'error']
  const envLevelIndex = levelOrder.indexOf(envLevel)
  const logLevelIndex = levelOrder.indexOf(level)

  // Filter by level.
  if (logLevelIndex < envLevelIndex) {
    return false
  }

  // Filter by scope.
  const scopeFilter = getScopeFilterFromEnv()
  if (scopeFilter && scopeFilter.length > 0) {
    return scopeFilter.includes(scope)
  }

  return true
}

/** Format log message for terminal. */
function formatTerminalLog(
  level: LogLevel,
  scope: string,
  timestamp: string,
  ...args: unknown[]
): string {
  const levelColor = getLevelColorAnsi(level)
  const scopeColor = getScopeColorAnsi(scope)
  const levelUpper = level.toUpperCase().padEnd(5)

  const message = args.map(serializeValue).join(' ')
  return `${timestamp} ${levelColor}${ANSI_BOLD}${levelUpper}${ANSI_RESET} ${scopeColor}${ANSI_BOLD}[${scope}]${ANSI_RESET} ${message}`
}

/** Create a logger function for a specific level. */
function createLogger(level: LogLevel) {
  return (scope: string, ...args: unknown[]) => {
    const timestamp = formatTimestamp()
    const message = args.map(serializeValue).join(' ')
    const entry: LogEntry = {
      timestamp,
      level,
      scope,
      message,
    }

    appendLog(entry)

    const terminalMessage = formatTerminalLog(level, scope, timestamp, ...args)

    if (shouldLogToTerminal(level, scope)) {
      console.log(terminalMessage)
    }
  }
}

/** Structured log entry type. */
export type LogEntry = {
  timestamp: string
  level: LogLevel
  scope: string
  message: string
}

/** Logger interface. */
export const logger = {
  debug: createLogger('debug'),
  info: createLogger('info'),
  warn: createLogger('warn'),
  error: createLogger('error'),
  clear: () => {},
}

/** Rust logger using the rust scope. */
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
