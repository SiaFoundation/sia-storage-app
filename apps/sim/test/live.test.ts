import { describe, expect, test } from 'bun:test'
import { addDevice } from '../src/devices'
import { objectsOnAccount, otherLiveSession, parseEnv, setEnvValue } from '../src/live'
import { Session } from '../src/session'

describe('the env file live mode reads and writes', () => {
  test('values are read with their quotes taken off, and comments are skipped', () => {
    const env = parseEnv(
      [
        '# Test account',
        'SIM_LIVE_INDEXER_URL="https://indexer.example"',
        "SIM_LIVE_RECOVERY_PHRASE='one two three'",
        'export PLAIN=value',
        'not a line',
      ].join('\n'),
    )
    expect(env).toEqual({
      SIM_LIVE_INDEXER_URL: 'https://indexer.example',
      SIM_LIVE_RECOVERY_PHRASE: 'one two three',
      PLAIN: 'value',
    })
  })

  test('a stored app key replaces the old one and leaves every other line as it was', () => {
    const before = '# keys\nA=1\nSIM_LIVE_APP_KEY="old"\nB=2\n'
    expect(setEnvValue(before, 'SIM_LIVE_APP_KEY', 'new')).toBe(
      '# keys\nA=1\nSIM_LIVE_APP_KEY="new"\nB=2\n',
    )
  })

  test('the first app key is added on its own line at the end', () => {
    expect(setEnvValue('A=1', 'SIM_LIVE_APP_KEY', 'k')).toBe('A=1\nSIM_LIVE_APP_KEY="k"\n')
    expect(setEnvValue('A=1\n\n', 'SIM_LIVE_APP_KEY', 'k')).toBe('A=1\nSIM_LIVE_APP_KEY="k"\n')
  })
})

describe('a live session', () => {
  test('takes phones and refuses CLI and desktop devices, which sign in on the mock network', async () => {
    const session = Session.create(`live-test-${crypto.randomUUID().slice(0, 8)}`, {
      fastTimers: true,
      live: true,
    })
    try {
      expect(Session.load(session.name)?.state.live).toBe(true)
      await addDevice(session, 'phone', 'ios')
      await expect(addDevice(session, 'laptop', 'cli')).rejects.toThrow('runs phones only')
      await expect(addDevice(session, 'mac', 'desktop')).rejects.toThrow('runs phones only')
      expect(Object.keys(session.state.devices)).toEqual(['phone'])
    } finally {
      session.remove()
    }
  })
})

describe('the files a live wipe deletes', () => {
  /** An account whose event history is `events`, served a page at a time the way the indexer does. */
  function account(events: Array<{ id: string; deleted?: boolean }>) {
    const history = events.map((e, i) => ({
      id: e.id,
      deleted: e.deleted ?? false,
      updatedAt: new Date(1_000 + i),
    }))
    const pages: number[] = []
    return {
      pages,
      objectEvents: async (
        cursor: { id: string; after: Date } | undefined | null,
        limit: number,
      ) => {
        const from = cursor ? history.findIndex((e) => e.updatedAt > cursor.after) : 0
        const page = from < 0 ? [] : history.slice(from, from + limit)
        pages.push(page.length)
        return page as never
      },
    }
  }

  test('are the objects whose last event is not a delete', async () => {
    const remaining = await objectsOnAccount(
      account([
        { id: 'kept' },
        { id: 'deleted' },
        { id: 'deleted', deleted: true },
        { id: 'back' },
        { id: 'back', deleted: true },
        { id: 'back' },
      ]),
    )
    expect([...remaining].sort()).toEqual(['back', 'kept'])
  })

  test('include objects past the first page of events', async () => {
    const sdk = account(Array.from({ length: 501 }, (_, i) => ({ id: `o${i}` })))
    const remaining = await objectsOnAccount(sdk)
    expect(remaining.size).toBe(501)
    expect(sdk.pages).toEqual([500, 1])
  })
})

describe('a live session that has phones on the account', () => {
  test('is found while its network answers, and a mock session or a stopped one is not', async () => {
    const network = Bun.serve({ port: 0, fetch: () => Response.json({ pid: process.pid }) })
    const id = crypto.randomUUID().slice(0, 8)
    const running = Session.create(`live-running-${id}`, { fastTimers: true, live: true })
    const stopped = Session.create(`live-stopped-${id}`, { fastTimers: true, live: true })
    const mock = Session.create(`mock-running-${id}`, { fastTimers: true })
    try {
      const url = `http://127.0.0.1:${network.port}`
      await running.update((s) => {
        s.networkUrl = url
      })
      await mock.update((s) => {
        s.networkUrl = url
      })
      expect(await otherLiveSession(stopped.name)).toBe(running.name)
      expect(await otherLiveSession(running.name)).toBeNull()
    } finally {
      network.stop(true)
      for (const s of [running, stopped, mock]) s.remove()
    }
  })
})

describe('a live session whose relay has stopped', () => {
  test('is still found while one of its phones runs the app, and not once none does', async () => {
    const id = crypto.randomUUID().slice(0, 8)
    const orphaned = Session.create(`live-orphaned-${id}`, { fastTimers: true, live: true })
    const me = Session.create(`live-me-${id}`, { fastTimers: true, live: true })
    try {
      await orphaned.update((s) => {
        s.networkUrl = 'http://127.0.0.1:9'
        s.devices.phone = { kind: 'ios', dir: orphaned.deviceDir('phone'), target: 'sim-1' }
      })
      const running = async (_s: unknown, device: string) => device === 'phone'
      const stopped = async () => false
      expect(await otherLiveSession(me.name, running)).toBe(orphaned.name)
      expect(await otherLiveSession(me.name, stopped)).toBeNull()
    } finally {
      orphaned.remove()
      me.remove()
    }
  })
})
