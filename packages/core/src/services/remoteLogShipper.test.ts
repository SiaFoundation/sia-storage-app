import type { AppService } from '../app/service'
import { RemoteLogShipper } from './remoteLogShipper'

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
  cursor: { current: number }
  setCursorCalls: number[]
  enabled: boolean
  endpoint: string
  token: string | null
  secretsCalls: { setItem: number; deleteItem: number; getItem: number }
}

function makeApp(initial?: Partial<MockApp>): MockApp {
  const state: MockApp = {
    app: {} as AppService,
    rows: [],
    cursor: { current: 0 },
    setCursorCalls: [],
    enabled: true,
    endpoint: 'https://logs.example.com/ingest',
    token: null,
    secretsCalls: { setItem: 0, deleteItem: 0, getItem: 0 },
    ...initial,
  }

  const settings = {
    setRemoteLogEnabled: async (v: boolean) => {
      state.enabled = v
    },
    setRemoteLogEndpoint: async (v: string) => {
      state.endpoint = v
    },
    setRemoteLogCursor: async (v: number) => {
      state.cursor.current = v
      state.setCursorCalls.push(v)
    },
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
    readSinceId: async (sinceId: number, limit: number) =>
      state.rows.filter((r) => r.id > sinceId).slice(0, limit),
  }

  state.app = { settings, secrets, logs } as unknown as AppService
  return state
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
  }
}

describe('RemoteLogShipper', () => {
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
    const shipper = new RemoteLogShipper(state.app, snapshot(state))
    await shipper.shipPending()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.cursor.current).toBe(0)
  })

  it('does nothing when endpoint is empty', async () => {
    const state = makeApp({ endpoint: '' })
    seedRows(state, 5)
    const shipper = new RemoteLogShipper(state.app, snapshot(state))
    await shipper.shipPending()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.cursor.current).toBe(0)
  })

  it('does nothing when there are no entries past the cursor', async () => {
    const state = makeApp()
    state.cursor.current = 5
    seedRows(state, 5)
    const shipper = new RemoteLogShipper(state.app, snapshot(state))
    await shipper.shipPending()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(state.cursor.current).toBe(5)
  })

  it('ships pending rows as NDJSON and advances the cursor on success', async () => {
    const state = makeApp()
    seedRows(state, 3)
    const shipper = new RemoteLogShipper(state.app, snapshot(state))

    await shipper.shipPending()

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
    const shipper = new RemoteLogShipper(state.app, snapshot(state))
    await shipper.shipPending()
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-xyz')
  })

  it('omits Authorization header when no token is set', async () => {
    const state = makeApp()
    seedRows(state, 1)
    const shipper = new RemoteLogShipper(state.app, snapshot(state))
    await shipper.shipPending()
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('does not advance the cursor when fetch rejects (offline)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'))
    const state = makeApp()
    seedRows(state, 4)
    const shipper = new RemoteLogShipper(state.app, snapshot(state))

    await shipper.shipPending()

    expect(state.cursor.current).toBe(0)
    expect(state.setCursorCalls).toEqual([])
  })

  it('does not advance the cursor on a non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    const state = makeApp()
    seedRows(state, 4)
    const shipper = new RemoteLogShipper(state.app, snapshot(state))

    await shipper.shipPending()

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
    const shipper = new RemoteLogShipper(state.app, snapshot(state))

    const first = shipper.shipPending()
    await shipper.shipPending()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch?.({ ok: true, status: 200 })
    await first
    expect(state.cursor.current).toBe(2)
  })

  it('replays the offline backlog on the next successful ship', async () => {
    const state = makeApp()
    seedRows(state, 3)
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    const shipper = new RemoteLogShipper(state.app, snapshot(state))

    await shipper.shipPending()
    expect(state.cursor.current).toBe(0)

    await shipper.shipPending()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const lines = (fetchMock.mock.calls[1][1].body as string).trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(state.cursor.current).toBe(3)
  })

  it('advances the cursor incrementally across successive ships', async () => {
    const state = makeApp()
    seedRows(state, 1)
    const shipper = new RemoteLogShipper(state.app, snapshot(state))

    await shipper.shipPending()
    expect(state.cursor.current).toBe(1)

    seedRows(state, 2)
    await shipper.shipPending()
    expect(state.cursor.current).toBe(3)
    expect(state.setCursorCalls).toEqual([1, 3])
  })

  it('reflects a config change without re-instantiating', async () => {
    const state = makeApp({ enabled: false })
    seedRows(state, 2)
    const shipper = new RemoteLogShipper(state.app, snapshot(state))

    await shipper.shipPending()
    expect(fetchMock).not.toHaveBeenCalled()

    await shipper.setConfig({ enabled: true })
    await shipper.shipPending()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.cursor.current).toBe(2)
    shipper.stop()
  })

  it('persists token to secrets and clears it when set to empty', async () => {
    const state = makeApp()
    const shipper = new RemoteLogShipper(state.app, snapshot(state))

    await shipper.setConfig({ token: 'tok' })
    expect(state.secretsCalls.setItem).toBe(1)
    expect(state.token).toBe('tok')

    await shipper.setConfig({ token: '' })
    expect(state.secretsCalls.deleteItem).toBe(1)
    expect(state.token).toBeNull()
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
    const shipper = new RemoteLogShipper(state.app, snapshot(state))

    await shipper.shipPending()

    const line = JSON.parse((fetchMock.mock.calls[0][1].body as string).trim())
    expect(line.data).toEqual({ device: 'devabc12', account: 'acct1234', extra: 1 })
  })

  describe('pause / stop', () => {
    it('pause aborts the in-flight POST', async () => {
      const state = makeApp()
      const captured: { signal?: AbortSignal } = {}
      let rejectFetch: (e: unknown) => void = () => {}
      fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal
        captured.signal = signal
        return new Promise((_resolve, reject) => {
          rejectFetch = reject
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      })
      state.rows.push({
        id: 1,
        timestamp: 't',
        level: 'info',
        scope: 's',
        message: 'm',
        data: null,
      })
      const shipper = new RemoteLogShipper(state.app, snapshot(state))

      const shipP = shipper.shipPending()
      await Promise.resolve()
      shipper.pause()
      expect(captured.signal?.aborted).toBe(true)

      await shipP.catch(() => {})
      rejectFetch(new Error('cleanup'))
      expect(state.cursor.current).toBe(0)
    })

    it('stop clears the ticker', async () => {
      jest.useFakeTimers()
      const state = makeApp()
      const shipper = new RemoteLogShipper(state.app, snapshot(state))
      shipper.start(2000)

      state.rows.push({
        id: 1,
        timestamp: 't',
        level: 'info',
        scope: 's',
        message: 'm',
        data: null,
      })
      await jest.advanceTimersByTimeAsync(2000)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      shipper.stop()
      const before = fetchMock.mock.calls.length
      state.rows.push({
        id: 2,
        timestamp: 't',
        level: 'info',
        scope: 's',
        message: 'm',
        data: null,
      })
      await jest.advanceTimersByTimeAsync(10000)
      expect(fetchMock).toHaveBeenCalledTimes(before)
      jest.useRealTimers()
    })

    it('stop is idempotent', () => {
      const state = makeApp()
      const shipper = new RemoteLogShipper(state.app, snapshot(state))
      shipper.start()
      shipper.stop()
      shipper.stop()
    })

    it('blocks future shipPending calls after stop until restart', async () => {
      const state = makeApp()
      state.rows.push({
        id: 1,
        timestamp: 't',
        level: 'info',
        scope: 's',
        message: 'm',
        data: null,
      })
      const shipper = new RemoteLogShipper(state.app, snapshot(state))

      shipper.stop()
      const before = fetchMock.mock.calls.length
      await shipper.shipPending()
      expect(fetchMock).toHaveBeenCalledTimes(before)

      shipper.start(60_000)
      await new Promise((r) => setTimeout(r, 0))
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before)
      shipper.stop()
    })
  })
})
