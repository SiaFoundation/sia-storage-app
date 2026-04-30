import { type LogEntry, serializeData, setLogAppender, setLogContext } from '@siastorage/logger'
import type { AppService } from '../app/service'

const REMOTE_LOG_TOKEN_KEY = 'remoteLogToken'
const REMOTE_LOG_TIMEOUT_MS = 30_000
const REMOTE_LOG_BATCH_SIZE = 200
const REMOTE_LOG_INTERVAL_MS = 2000
const ID_PREFIX_LEN = 8

type Snapshot = {
  enabled: boolean
  endpoint: string
  cursor: number
  token: string | null
  deviceId: string
}

export type RemoteLogConfigUpdate = {
  enabled?: boolean
  endpoint?: string
  token?: string | null
}

type LogRowWire = {
  id: number
  timestamp: string
  level: string
  scope: string
  message: string
  data: string | null
}

/**
 * Forwards structured logs to a user-supplied HTTP endpoint as NDJSON. The DB
 * sink and HTTP sink run independently: the appender only writes to the local
 * log table; a separate ticker reads since a persisted cursor and POSTs the
 * batch. A network outage stalls the cursor but never blocks DB persistence.
 */
export class LogForwarder {
  private snapshot: Snapshot
  private inflight: Promise<void> | null = null
  private stopped = false
  private httpTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly app: AppService,
    snapshot: Snapshot,
  ) {
    this.snapshot = snapshot
  }

  static async create(app: AppService): Promise<LogForwarder> {
    const [enabled, endpoint, cursor, token, deviceId, mnemonicHash] = await Promise.all([
      app.settings.getRemoteLogEnabled(),
      app.settings.getRemoteLogEndpoint(),
      app.settings.getRemoteLogCursor(),
      app.secrets.getItem(REMOTE_LOG_TOKEN_KEY),
      app.settings.getDeviceId(),
      app.auth.getMnemonicHash(),
    ])
    applyLogContext(deviceId, mnemonicHash)
    return new LogForwarder(app, { enabled, endpoint, cursor, token, deviceId })
  }

  /** Appender registered with the logger package: persists every entry
   * locally. Independent of the HTTP sink — a network outage cannot affect
   * the DB write that this function performs. */
  appender = async (entries: LogEntry[]): Promise<void> => {
    try {
      await this.app.logs.appendMany(
        entries.map((entry) => ({
          timestamp: entry.timestamp,
          level: entry.level,
          scope: entry.scope,
          message: entry.message,
          data: serializeData(entry.data),
        })),
      )
    } catch (error) {
      console.warn('[logForwarder] db append failed:', error)
    }
  }

  /** Start the HTTP shipping ticker. Idempotent. Drains immediately so any
   * backlog from a previous offline session ships without waiting for a tick. */
  start(intervalMs: number = REMOTE_LOG_INTERVAL_MS): void {
    if (this.httpTimer) return
    this.stopped = false
    this.httpTimer = setInterval(() => {
      void this.shipPending()
    }, intervalMs)
    void this.shipPending()
  }

  /** Stop the HTTP ticker and await any in-flight ship. The DB appender is
   * unaffected. Idempotent. */
  async stop(): Promise<void> {
    this.stopped = true
    if (this.httpTimer) {
      clearInterval(this.httpTimer)
      this.httpTimer = null
    }
    if (this.inflight) await this.inflight
  }

  /** Persist config changes and refresh the snapshot used by the HTTP sink. */
  async setConfig(update: RemoteLogConfigUpdate): Promise<void> {
    if (update.enabled !== undefined) {
      await this.app.settings.setRemoteLogEnabled(update.enabled)
      this.snapshot.enabled = update.enabled
    }
    if (update.endpoint !== undefined) {
      await this.app.settings.setRemoteLogEndpoint(update.endpoint)
      this.snapshot.endpoint = update.endpoint
    }
    if (update.token !== undefined) {
      if (!update.token) {
        await this.app.secrets.deleteItem(REMOTE_LOG_TOKEN_KEY)
        this.snapshot.token = null
      } else {
        await this.app.secrets.setItem(REMOTE_LOG_TOKEN_KEY, update.token)
        this.snapshot.token = update.token
      }
    }
  }

  getToken(): Promise<string | null> {
    return this.app.secrets.getItem(REMOTE_LOG_TOKEN_KEY)
  }

  /** Re-read the user identity (mnemonic hash) and update the log context so
   * subsequent log entries carry the new accountId in their data field. Reset
   * and sign-out are handled automatically because LogForwarder is recreated
   * on app re-init. */
  async refreshAccount(): Promise<void> {
    const mnemonicHash = await this.app.auth.getMnemonicHash()
    applyLogContext(this.snapshot.deviceId, mnemonicHash)
  }

  /**
   * Read the next batch of unshipped rows from the DB and POST them. Cursor
   * advances only on success, so an offline gap is replayed on the next call.
   * Skip while a request is in flight to avoid fan-out on a degraded network.
   */
  async shipPending(): Promise<void> {
    if (this.stopped || this.inflight) return
    if (!this.snapshot.enabled || !this.snapshot.endpoint) return
    this.inflight = this.runShip().finally(() => {
      this.inflight = null
    })
    await this.inflight
  }

  private async runShip(): Promise<void> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REMOTE_LOG_TIMEOUT_MS)
    try {
      const rows = await this.app.logs.readSinceId(this.snapshot.cursor, REMOTE_LOG_BATCH_SIZE)
      if (rows.length === 0) return
      const body = rows.map(rowToWireLine).join('')
      const headers: Record<string, string> = { 'Content-Type': 'application/x-ndjson' }
      if (this.snapshot.token) headers.Authorization = `Bearer ${this.snapshot.token}`
      const res = await fetch(this.snapshot.endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      })
      if (!res.ok) {
        console.warn('[logForwarder] endpoint returned', res.status)
        return
      }
      const lastId = rows[rows.length - 1].id
      this.snapshot.cursor = lastId
      await this.app.settings.setRemoteLogCursor(lastId)
    } catch (error) {
      console.warn('[logForwarder] ship failed:', error)
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

function rowToWireLine(row: LogRowWire): string {
  return `${JSON.stringify({
    id: row.id,
    timestamp: row.timestamp,
    level: row.level,
    scope: row.scope,
    message: row.message,
    data: row.data ? safeParse(row.data) : undefined,
  })}\n`
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/** Set the log context from the current device id and (optional) mnemonic
 * hash. Account is the trimmed prefix of the hash. Used at app boot, after
 * sign-in, and on reset so every code path lands on the same context shape. */
export function applyLogContext(deviceId: string, mnemonicHash: string | null): void {
  const account = mnemonicHash ? mnemonicHash.slice(0, ID_PREFIX_LEN) : null
  setLogContext(account ? { device: deviceId, account } : { device: deviceId })
}

let instance: LogForwarder | null = null

/** Initialize the singleton forwarder, register the DB appender, and start
 * the HTTP ticker. */
export async function initLogForwarder(app: AppService): Promise<void> {
  if (instance) await instance.stop()
  instance = await LogForwarder.create(app)
  setLogAppender(instance.appender)
  instance.start()
}

/** Stop the singleton HTTP ticker and await any in-flight ship. Called on
 * suspend so the cursor UPDATE doesn't race the DB close. Idempotent. */
export async function stopLogForwarder(): Promise<void> {
  if (!instance) return
  await instance.stop()
}

/** Re-register the appender and restart the HTTP ticker after suspension. */
export function resumeLogForwarder(): void {
  if (!instance) return
  setLogAppender(instance.appender)
  instance.start()
}

export function setRemoteLogConfig(update: RemoteLogConfigUpdate): Promise<void> {
  if (!instance) throw new Error('logForwarder not initialized')
  return instance.setConfig(update)
}

export function getRemoteLogToken(): Promise<string | null> {
  return instance ? instance.getToken() : Promise.resolve(null)
}

/** Re-read the current account key and refresh the log context. Call after
 * sign-in so the new accountId reaches both the wire and the terminal. */
export function refreshLogAccount(): Promise<void> {
  return instance ? instance.refreshAccount() : Promise.resolve()
}
