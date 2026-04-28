import type { LogEntry } from '@siastorage/logger'
import * as loggerPkg from '@siastorage/logger'
import type { AppService } from '../app/service'
import { LogForwarder } from './logForwarder'

type Row = {
  id: number
  timestamp: string
  level: string
  scope: string
  message: string
  data: string | null
}

type MockApp = {
  app: AppService
  rows: Row[]
  appendedToDb: {
    timestamp: string
    level: string
    scope: string
    message: string
    data: string | null
  }[]
  cursor: { current: number }
  setCursorCalls: number[]
  enabled: boolean
  endpoint: string
  token: string | null
  deviceId: string
  mnemonicHash: string | null
  secretsCalls: { setItem: number; deleteItem: number; getItem: number }
}

function makeApp(initial?: Partial<MockApp>): MockApp {
  const state: MockApp = {
    app: {} as AppService,
    rows: [],
    appendedToDb: [],
    cursor: { current: 0 },
    setCursorCalls: [],
    enabled: true,
    endpoint: 'https://logs.example.com/ingest',
    token: null,
    deviceId: 'device-test-fixed',
    mnemonicHash: null,
    secretsCalls: { setItem: 0, deleteItem: 0, getItem: 0 },
    ...initial,
  }

  const settings = {
    getRemoteLogEnabled: async () => state.enabled,
    setRemoteLogEnabled: async (v: boolean) => {
      state.enabled = v
    },
    getRemoteLogEndpoint: async () => state.endpoint,
    setRemoteLogEndpoint: async (v: string) => {
      state.endpoint = v
    },
    getRemoteLogCursor: async () => state.cursor.current,
    setRemoteLogCursor: async (v: number) => {
      state.cursor.current = v
      state.setCursorCalls.push(v)
    },
    getDeviceId: async () => state.deviceId,
  }

  const auth = {
    getMnemonicHash: async () => state.mnemonicHash,
  }

  const secrets = {
    getItem: async (_key: string) => {
      state.secretsCalls.getItem++
      return state.token
    },
    setItem: async (_key: string, value: string) => {
      state.secretsCalls.setItem++
      state.token = value
    },
    deleteItem: async (_key: string) => {
      state.secretsCalls.deleteItem++
      state.token = null
    },
  }

  const logs = {
    appendMany: async (
      entries: {
        timestamp: string
        level: string
        scope: string
        message: string
        data: string | null
      }[],
    ) => {
      state.appendedToDb.push(...entries)
      const startId = state.rows.length > 0 ? state.rows[state.rows.length - 1].id : 0
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        state.rows.push({
          id: startId + i + 1,
          timestamp: e.timestamp,
          level: e.level,
          scope: e.scope,
          message: e.message,
          data: e.data,
        })
      }
    },
    readSinceId: async (sinceId: number, limit: number) =>
      state.rows.filter((r) => r.id > sinceId).slice(0, limit),
  }

  state.app = { settings, secrets, logs, auth } as unknown as AppService
  return state
}

function entry(message: string, data?: Record<string, unknown>): LogEntry {
  return { timestamp: '2026-01-01T00:00:00.000Z', level: 'info', scope: 'test', message, data }
}

function seedRows(state: MockApp, count: number): void {
  const next = [...Array(count)].map((_, i) => ({
    id: state.rows.length + i + 1,
    timestamp: `2026-01-01T00:00:0${i % 10}.000Z`,
    level: 'info',
    scope: 'test',
    message: `msg-${state.rows.length + i + 1}`,
    data: null,
  }))
  state.rows.push(...next)
}

function snapshot(state: MockApp) {
  return {
    enabled: state.enabled,
    endpoint: state.endpoint,
    cursor: state.cursor.current,
    token: state.token,
    deviceId: state.deviceId,
  }
}

describe('LogForwarder', () => {
  let fetchMock: jest.Mock
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    global.fetch = fetchMock as unknown as typeof fetch
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('does nothing when disabled', async () => {
    const state = makeApp({ enabled: false })
    seedRows(state, 5)
    const forwarder = new LogForwarder(state.app, snapshot(state))
    await forwarder.shipPending()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.cursor.current).toBe(0)
  })

  it('does nothing when endpoint is empty', async () => {
    const state = makeApp({ endpoint: '' })
    seedRows(state, 5)
    const forwarder = new LogForwarder(state.app, snapshot(state))
    await forwarder.shipPending()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.cursor.current).toBe(0)
  })

  it('does nothing when there are no entries past the cursor', async () => {
    const state = makeApp()
    state.cursor.current = 5
    seedRows(state, 5)
    const forwarder = new LogForwarder(state.app, snapshot(state))
    await forwarder.shipPending()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.cursor.current).toBe(5)
  })

  it('ships pending rows as NDJSON and advances the cursor on success', async () => {
    const state = makeApp()
    seedRows(state, 3)
    const forwarder = new LogForwarder(state.app, snapshot(state))

    await forwarder.shipPending()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(state.endpoint)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/x-ndjson')
    const body = init.body as string
    expect(body.endsWith('\n')).toBe(true)
    const lines = body.trim().split('\n')
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
    expect(state.cursor.current).toBe(3)
    expect(state.setCursorCalls).toEqual([3])
  })

  it('includes Authorization header when a token is set', async () => {
    const state = makeApp({ token: 'secret-xyz' })
    seedRows(state, 1)
    const forwarder = new LogForwarder(state.app, snapshot(state))
    await forwarder.shipPending()
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers.Authorization).toBe('Bearer secret-xyz')
  })

  it('omits Authorization header when no token is set', async () => {
    const state = makeApp()
    seedRows(state, 1)
    const forwarder = new LogForwarder(state.app, snapshot(state))
    await forwarder.shipPending()
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('does not advance the cursor when fetch rejects (offline)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'))
    const state = makeApp()
    seedRows(state, 4)
    const forwarder = new LogForwarder(state.app, snapshot(state))

    await forwarder.shipPending()

    expect(state.cursor.current).toBe(0)
    expect(state.setCursorCalls).toEqual([])
  })

  it('does not advance the cursor on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    const state = makeApp()
    seedRows(state, 4)
    const forwarder = new LogForwarder(state.app, snapshot(state))

    await forwarder.shipPending()

    expect(state.cursor.current).toBe(0)
    expect(state.setCursorCalls).toEqual([])
  })

  it('skips overlapping calls while a request is in flight', async () => {
    let resolveFetch: ((value: { ok: boolean; status: number }) => void) | undefined
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    const state = makeApp()
    seedRows(state, 2)
    const forwarder = new LogForwarder(state.app, snapshot(state))

    const first = forwarder.shipPending()
    await forwarder.shipPending()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch?.({ ok: true, status: 200 })
    await first
    expect(state.cursor.current).toBe(2)
  })

  it('appender does not call fetch — sinks are decoupled', async () => {
    const state = makeApp()
    const forwarder = new LogForwarder(state.app, snapshot(state))

    await forwarder.appender([entry('a'), entry('b')])

    expect(state.appendedToDb).toHaveLength(2)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.cursor.current).toBe(0)
  })

  it('writes to the DB even when the HTTP sink fails (sink independence)', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))
    const state = makeApp()
    const forwarder = new LogForwarder(state.app, snapshot(state))

    await forwarder.appender([entry('a'), entry('b')])
    await forwarder.shipPending()

    expect(state.appendedToDb).toHaveLength(2)
    expect(state.appendedToDb.map((e) => e.message)).toEqual(['a', 'b'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.cursor.current).toBe(0)
  })

  it('replays the offline backlog on the next successful ship', async () => {
    const state = makeApp()
    const forwarder = new LogForwarder(state.app, snapshot(state))

    await forwarder.appender([entry('1'), entry('2'), entry('3')])
    fetchMock.mockRejectedValue(new TypeError('offline'))
    await forwarder.shipPending()
    expect(state.cursor.current).toBe(0)

    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    await forwarder.shipPending()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const successCallBody = (fetchMock.mock.calls[1][1].body as string).trim().split('\n')
    expect(successCallBody).toHaveLength(3)
    expect(state.cursor.current).toBe(3)
  })

  it('advances the cursor incrementally across successive ships', async () => {
    const state = makeApp()
    const forwarder = new LogForwarder(state.app, snapshot(state))

    await forwarder.appender([entry('a')])
    await forwarder.shipPending()
    expect(state.cursor.current).toBe(1)

    await forwarder.appender([entry('b'), entry('c')])
    await forwarder.shipPending()
    expect(state.cursor.current).toBe(3)
    expect(state.setCursorCalls).toEqual([1, 3])
  })

  it('catches up backlog without new appender activity (idle ticker)', async () => {
    const state = makeApp()
    seedRows(state, 5)
    const forwarder = new LogForwarder(state.app, snapshot(state))

    await forwarder.shipPending()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.cursor.current).toBe(5)
  })

  it('reflects a config change without re-instantiating', async () => {
    const state = makeApp({ enabled: false })
    seedRows(state, 2)
    const forwarder = new LogForwarder(state.app, snapshot(state))

    await forwarder.shipPending()
    expect(fetchMock).not.toHaveBeenCalled()

    await forwarder.setConfig({ enabled: true })
    await forwarder.shipPending()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.cursor.current).toBe(2)
  })

  it('persists token to secrets and clears it when set to empty', async () => {
    const state = makeApp()
    const forwarder = new LogForwarder(state.app, snapshot(state))

    await forwarder.setConfig({ token: 'tok' })
    expect(state.secretsCalls.setItem).toBe(1)
    expect(state.token).toBe('tok')

    await forwarder.setConfig({ token: '' })
    expect(state.secretsCalls.deleteItem).toBe(1)
    expect(state.token).toBeNull()
  })

  it('seeds the log context with device only when not authed', async () => {
    const state = makeApp()
    const spy = jest.spyOn(loggerPkg, 'setLogContext')
    await LogForwarder.create(state.app)
    expect(spy).toHaveBeenLastCalledWith({ device: state.deviceId })
    spy.mockRestore()
  })

  it('seeds the log context with device + 8-char account when authed', async () => {
    const state = makeApp({ mnemonicHash: 'abcdef0123456789'.repeat(4) })
    const spy = jest.spyOn(loggerPkg, 'setLogContext')
    await LogForwarder.create(state.app)
    expect(spy).toHaveBeenLastCalledWith({ device: state.deviceId, account: 'abcdef01' })
    spy.mockRestore()
  })

  it('refreshAccount updates the log context with the new (trimmed) account', async () => {
    const state = makeApp()
    const forwarder = new LogForwarder(state.app, snapshot(state))
    state.mnemonicHash = 'fedcba9876543210'.repeat(4)
    const spy = jest.spyOn(loggerPkg, 'setLogContext')
    await forwarder.refreshAccount()
    expect(spy).toHaveBeenLastCalledWith({ device: state.deviceId, account: 'fedcba98' })
    spy.mockRestore()
  })

  it('passes the data field through from DB to wire', async () => {
    const state = makeApp()
    state.rows.push({
      id: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
      scope: 'test',
      message: 'hello',
      data: JSON.stringify({ device: 'devabc12', account: 'acct1234', extra: 1 }),
    })
    const forwarder = new LogForwarder(state.app, snapshot(state))

    await forwarder.shipPending()

    const line = JSON.parse((fetchMock.mock.calls[0][1].body as string).trim())
    expect(line.data).toEqual({ device: 'devabc12', account: 'acct1234', extra: 1 })
  })
})
