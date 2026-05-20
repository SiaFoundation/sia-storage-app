import type { LogEntry } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { DbLogAppender } from './dbLogAppender'

type AppendedRow = {
  timestamp: string
  level: string
  scope: string
  message: string
  data: string | null
}

type MockApp = {
  app: AppService
  appended: AppendedRow[]
  /** When set, appendMany rejects once before succeeding on the next call. */
  failNext: boolean
}

function makeApp(initial?: Partial<MockApp>): MockApp {
  const state: MockApp = {
    app: {} as AppService,
    appended: [],
    failNext: false,
    ...initial,
  }
  const logs = {
    appendMany: async (entries: AppendedRow[]) => {
      if (state.failNext) {
        state.failNext = false
        throw new Error('db locked')
      }
      state.appended.push(...entries)
    },
  }
  state.app = { logs } as unknown as AppService
  return state
}

function entry(message: string): LogEntry {
  return { timestamp: '2026-01-01T00:00:00.000Z', level: 'info', scope: 'test', message }
}

describe('DbLogAppender', () => {
  it('queues writes and drains to the DB on flush', async () => {
    const state = makeApp()
    const appender = new DbLogAppender(state.app)

    appender.write(entry('a'))
    appender.write(entry('b'))
    expect(state.appended).toHaveLength(0)

    await appender.flush()
    expect(state.appended.map((e) => e.message)).toEqual(['a', 'b'])
  })

  it('write() persists regardless of any external toggle — it has no opinions', async () => {
    const state = makeApp()
    const appender = new DbLogAppender(state.app)

    appender.write(entry('x'))
    await appender.flush()

    expect(state.appended.map((e) => e.message)).toEqual(['x'])
  })

  it('flushBeforeSuspend fires appendMany synchronously without awaiting', async () => {
    const state = makeApp()
    const appender = new DbLogAppender(state.app)
    appender.write(entry('a'))
    appender.write(entry('b'))

    appender.flushBeforeSuspend()
    await Promise.resolve()

    expect(state.appended.map((e) => e.message)).toEqual(['a', 'b'])
  })

  it('reinstates the batch on append failure so the next drain retries', async () => {
    const state = makeApp({ failNext: true })
    const appender = new DbLogAppender(state.app)

    appender.write(entry('a'))
    await appender.flush()
    expect(state.appended).toHaveLength(0)

    await appender.flush()
    expect(state.appended.map((e) => e.message)).toEqual(['a'])
  })

  it('pause halts the drain timer but keeps accepting writes; resume drains', async () => {
    const state = makeApp()
    const appender = new DbLogAppender(state.app)
    appender.start()
    appender.pause()

    appender.write(entry('during-pause'))
    expect(state.appended).toHaveLength(0)

    appender.resume()
    await Promise.resolve()
    expect(state.appended.map((e) => e.message)).toEqual(['during-pause'])
    appender.stop()
  })

  it('stop blocks future writes', async () => {
    const state = makeApp()
    const appender = new DbLogAppender(state.app)
    appender.stop()

    appender.write(entry('ignored'))
    await appender.flush()

    expect(state.appended).toHaveLength(0)
  })

  it('stop is idempotent', () => {
    const appender = new DbLogAppender(makeApp().app)
    appender.start()
    appender.stop()
    appender.stop()
  })
})
