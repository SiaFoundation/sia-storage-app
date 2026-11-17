import type { AppService } from '../app/service'
import { OLDER_VERSION_TRASH_INTERVAL } from '../config'
import { runShareLinkSync } from './shareLinks'

/** An app whose share-link calls resolve, or reject when `fail` says, recording the order of calls. */
function stubApp(opts: { connected?: boolean; fail?: boolean } = {}) {
  const calls: string[] = []
  const app = {
    connection: { getState: () => ({ isConnected: opts.connected ?? true }) },
    shares: {
      syncLinks: jest.fn(async () => {
        calls.push('syncLinks')
      }),
      syncLinksAndTrashOlderVersions: jest.fn(async () => {
        calls.push('syncLinksAndTrash')
        if (opts.fail) throw new Error('indexer unavailable')
        return 0
      }),
    },
  } as unknown as AppService
  return { app, calls }
}

describe('runShareLinkSync and older versions', () => {
  let now = 1_000_000
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockImplementation(() => now)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('lists the links and trashes older versions on the first pass', async () => {
    const { app, calls } = stubApp()

    await runShareLinkSync(app)

    expect(calls).toEqual(['syncLinksAndTrash'])
  })

  it('does nothing while offline', async () => {
    const { app, calls } = stubApp({ connected: false })

    await runShareLinkSync(app)

    expect(calls).toEqual([])
  })

  it('trashes older versions at most once an interval and runs a plain pass in between', async () => {
    const { app, calls } = stubApp()

    await runShareLinkSync(app)
    now += OLDER_VERSION_TRASH_INTERVAL - 1
    await runShareLinkSync(app)
    now += 1
    await runShareLinkSync(app)

    expect(calls).toEqual(['syncLinksAndTrash', 'syncLinks', 'syncLinksAndTrash'])
  })

  it('waits the interval after a pass that fails', async () => {
    const { app, calls } = stubApp({ fail: true })

    await runShareLinkSync(app)
    now += 1
    await runShareLinkSync(app)

    expect(calls).toEqual(['syncLinksAndTrash', 'syncLinks'])
  })
})
