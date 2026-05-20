import { ANSI_BOLD, ANSI_DIM, ANSI_RESET, getLevelColorAnsi, getScopeColorAnsi } from './logColors'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

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

const CONTEXT_KEYS = ['device', 'account'] as const
const NO_ACCOUNT_PLACEHOLDER = '--------'

function pickContext(data?: LogData): { device?: string; account?: string } {
  if (!data) return {}
  return {
    device: typeof data.device === 'string' ? data.device : undefined,
    account: typeof data.account === 'string' ? data.account : undefined,
  }
}

function excludeContextKeys(data?: LogData): LogData | undefined {
  if (!data || !CONTEXT_KEYS.some((k) => k in data)) return data
  const out: LogData = {}
  for (const [k, v] of Object.entries(data)) {
    if (!(CONTEXT_KEYS as readonly string[]).includes(k)) out[k] = v
  }
  return out
}

/** ANSI-colored single-line format. */
export function formatTerminalLog(entry: LogEntry): string {
  const levelColor = getLevelColorAnsi(entry.level)
  const scopeColor = getScopeColorAnsi(entry.scope)
  const levelUpper = entry.level.toUpperCase().padEnd(5)
  const { device, account } = pickContext(entry.data)
  const contextPart = device
    ? `${ANSI_DIM}[${device}][${account ?? NO_ACCOUNT_PLACEHOLDER}]${ANSI_RESET}`
    : ''
  const dataPart = formatDataPairs(excludeContextKeys(entry.data))
  const messagePart = dataPart ? `${entry.message} ${dataPart}` : entry.message
  return `${entry.timestamp} ${levelColor}${ANSI_BOLD}${levelUpper}${ANSI_RESET} ${contextPart}${scopeColor}${ANSI_BOLD}[${entry.scope}]${ANSI_RESET} ${messagePart}`
}

/** Plain-text single-line format (no ANSI). */
export function formatPlainLog(entry: LogEntry): string {
  const levelUpper = entry.level.toUpperCase().padEnd(5)
  const { device, account } = pickContext(entry.data)
  const contextPart = device ? `[${device}][${account ?? NO_ACCOUNT_PLACEHOLDER}] ` : ''
  const dataPart = formatDataPairs(excludeContextKeys(entry.data))
  const messagePart = dataPart ? `${entry.message} ${dataPart}` : entry.message
  return `${entry.timestamp} ${levelUpper} ${contextPart}[${entry.scope}] ${messagePart}`
}

let logContext: Record<string, unknown> = {}

/** Set fields merged into the data of every subsequent entry (device id,
 * account id). Caller-supplied data keys win on conflict. */
export function setLogContext(ctx: Record<string, unknown>): void {
  logContext = ctx
}

function mergeContext(data?: LogData): LogData | undefined {
  if (Object.keys(logContext).length === 0) return data
  return { ...(logContext as LogData), ...(data ?? {}) }
}

/**
 * Output sink for log entries. Errors from `write` are swallowed so one
 * misbehaving appender cannot starve others. Batching appenders own
 * their own queue + timer. `pause` is sync and must keep accepting
 * writes; `stop` is hard teardown with no flush guarantee.
 */
export type Appender = {
  write(entry: LogEntry): void
  flush?(): Promise<void> | void
  stop?(): Promise<void> | void
  pause?(): void
  resume?(): void
}

const appenders = new Set<Appender>()
const noAppenderBuffer: LogEntry[] = []

/** Register an appender. Drains any pre-registration entries into it. */
export function addAppender(a: Appender): void {
  appenders.add(a)
  if (noAppenderBuffer.length > 0) {
    const drain = noAppenderBuffer.splice(0)
    for (const entry of drain) {
      try {
        a.write(entry)
      } catch {}
    }
    try {
      void a.flush?.()
    } catch {}
  }
}

/** Unregister an appender. Does not call `stop` — caller owns teardown. */
export function removeAppender(a: Appender): void {
  appenders.delete(a)
}

/** Flush every registered appender. Resolves after all settle. */
export async function flushAllAppenders(): Promise<void> {
  await Promise.allSettled(Array.from(appenders).map((a) => Promise.resolve(a.flush?.())))
}

/** Reset the registry. For test setup/teardown only. */
export function clearAppenders(): void {
  appenders.clear()
  noAppenderBuffer.length = 0
}

function dispatch(entry: LogEntry): void {
  if (appenders.size === 0) {
    noAppenderBuffer.push(entry)
    return
  }
  // Snapshot so an appender's `write` can call add/removeAppender mid-iteration.
  for (const a of [...appenders]) {
    try {
      a.write(entry)
    } catch {}
  }
}

function createLogger(level: LogLevel) {
  return (scope: string, msg: string, data?: LogData) => {
    const timestamp = formatTimestamp()
    const merged = mergeContext(data)
    const entry: LogEntry = {
      timestamp,
      level,
      scope,
      message: msg,
      data: merged,
    }

    dispatch(entry)
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
