import type { AppService } from '../app/service'

const REMOTE_LOG_TOKEN_KEY = 'remoteLogToken'
const SHIP_TIMEOUT_MS = 30_000
const SHIP_BATCH_SIZE = 200
const SHIP_INTERVAL_MS = 30_000

type Snapshot = {
  enabled: boolean
  endpoint: string
  cursor: number
  token: string | null
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
 * Polls the local `logs` table past a persisted cursor and POSTs unsent
 * rows to a user-configured NDJSON endpoint. Reads only — never writes
 * to the DB.
 */
class RemoteLogShipper {
  private snapshot: Snapshot
  private inflight: Promise<void> | null = null
  private inflightController: AbortController | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private paused = false

  constructor(
    private readonly app: AppService,
    snapshot: Snapshot,
  ) {
    this.snapshot = snapshot
  }

  start(intervalMs: number = SHIP_INTERVAL_MS): void {
    this.stopped = false
    this.paused = false
    if (this.timer) return
    if (!this.snapshot.enabled || !this.snapshot.endpoint) return
    this.timer = setInterval(() => void this.shipPending(), intervalMs)
    void this.shipPending()
  }

  stop(): void {
    this.stopped = true
    this.clearTimer()
    this.inflightController?.abort()
  }

  pause(): void {
    this.paused = true
    this.clearTimer()
    this.inflightController?.abort()
  }

  resume(): void {
    if (this.stopped) return
    this.start()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

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
    if (this.snapshot.enabled && this.snapshot.endpoint) this.start()
    else this.stop()
  }

  getToken(): Promise<string | null> {
    return this.app.secrets.getItem(REMOTE_LOG_TOKEN_KEY)
  }

  async shipPending(): Promise<void> {
    if (this.stopped || this.paused || this.inflight) return
    if (!this.snapshot.enabled || !this.snapshot.endpoint) return
    this.inflight = this.runShip().finally(() => {
      this.inflight = null
    })
    await this.inflight
  }

  private async runShip(): Promise<void> {
    const controller = new AbortController()
    this.inflightController = controller
    const timeoutId = setTimeout(() => controller.abort(), SHIP_TIMEOUT_MS)
    try {
      const rows = await this.app.logs.readSinceId(this.snapshot.cursor, SHIP_BATCH_SIZE)
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
        console.warn('[remoteLogShipper] endpoint returned', res.status)
        return
      }
      const lastId = rows[rows.length - 1].id
      this.snapshot.cursor = lastId
      await this.app.settings.setRemoteLogCursor(lastId)
    } catch (error) {
      console.warn('[remoteLogShipper] ship failed:', error)
    } finally {
      clearTimeout(timeoutId)
      if (this.inflightController === controller) this.inflightController = null
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

let instance: RemoteLogShipper | null = null

export async function initRemoteLogShipper(app: AppService): Promise<void> {
  if (instance) instance.stop()
  const [enabled, endpoint, cursor, token] = await Promise.all([
    app.settings.getRemoteLogEnabled(),
    app.settings.getRemoteLogEndpoint(),
    app.settings.getRemoteLogCursor(),
    app.secrets.getItem(REMOTE_LOG_TOKEN_KEY),
  ])
  instance = new RemoteLogShipper(app, { enabled, endpoint, cursor, token })
  instance.start()
}

export function pauseRemoteLogShipper(): void {
  instance?.pause()
}

export function resumeRemoteLogShipper(): void {
  instance?.resume()
}

export function shutdownRemoteLogShipper(): void {
  if (!instance) return
  instance.stop()
  instance = null
}

export function setRemoteLogConfig(update: RemoteLogConfigUpdate): Promise<void> {
  if (!instance) throw new Error('remoteLogShipper not initialized')
  return instance.setConfig(update)
}

export function getRemoteLogToken(): Promise<string | null> {
  return instance ? instance.getToken() : Promise.resolve(null)
}

export { RemoteLogShipper }
