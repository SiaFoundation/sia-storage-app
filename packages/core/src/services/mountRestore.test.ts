import type { AppService } from '../app/service'
import { minutesInMs } from '../lib/time'
import { type RestoreAsk, restoreFromMount } from './mountRestore'

/**
 * A run asks the system for at most 50 files, and a file it would not hand
 * back waits an hour before it is asked for again. The stranded query lists
 * files by last use, so the order a run picks them in decides whether files
 * behind a batch that keeps failing are ever asked for.
 */
function strandedApp(count: number) {
  const stackIds = Array.from({ length: count }, (_, i) => `s${String(i + 1).padStart(3, '0')}`)
  const asked: string[][] = []
  const app = {
    settings: { getIndexerURL: async () => 'https://next.indexer' },
    mountCopies: {
      stranded: async (_indexerURL: string, limit: number) =>
        stackIds.slice(0, limit).map((stackId) => ({ stackId, fileId: `f-${stackId}` })),
      delete: async () => [],
    },
    mount: {
      resend: async (ids: string[]) => {
        asked.push(ids)
        return Object.fromEntries(ids.map((id) => [id, 'failed' as const]))
      },
    },
  } as unknown as AppService
  return { app, stackIds, asked }
}

describe('restoreFromMount', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('asks for a file behind a full batch that failed once the failures may be asked again', async () => {
    const { app, stackIds, asked } = strandedApp(51)
    const asks = new Map<string, RestoreAsk>()
    const start = Date.now()
    jest.spyOn(Date, 'now').mockReturnValue(start)

    await restoreFromMount(app, asks)
    expect(asked[0]).toEqual(stackIds.slice(0, 50))

    jest.spyOn(Date, 'now').mockReturnValue(start + minutesInMs(61))
    await restoreFromMount(app, asks)

    expect(asked[1]).toHaveLength(50)
    expect(asked[1][0]).toBe('s051')
  })

  it('asks again first the files asked longest ago', async () => {
    const { app, asked } = strandedApp(3)
    const start = Date.now()
    const asks = new Map<string, RestoreAsk>([
      ['s001', { askedAt: start - minutesInMs(70), askAgainAt: start - minutesInMs(10) }],
      ['s002', { askedAt: start - minutesInMs(90), askAgainAt: start - minutesInMs(30) }],
      ['s003', { askedAt: start - minutesInMs(80), askAgainAt: start - minutesInMs(20) }],
    ])
    jest.spyOn(Date, 'now').mockReturnValue(start)

    await restoreFromMount(app, asks)

    expect(asked[0]).toEqual(['s002', 's003', 's001'])
  })

  it('forgets a file that is no longer stranded once the query lists every stranded file', async () => {
    const { app } = strandedApp(1)
    const start = Date.now()
    const asks = new Map<string, RestoreAsk>([
      ['gone', { askedAt: start, askAgainAt: start + minutesInMs(60) }],
    ])
    jest.spyOn(Date, 'now').mockReturnValue(start)

    await restoreFromMount(app, asks)

    expect([...asks.keys()]).toEqual(['s001'])
  })
})
