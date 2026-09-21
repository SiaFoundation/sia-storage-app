import { beforeEach, describe, expect, it, mock } from 'bun:test'

/*
 * Covers which helper command each kind of stop runs. Signing out and quitting
 * differ in exactly one way that matters, and getting it wrong leaves the
 * account's file names and downloaded contents in the system's copy.
 *
 * The helper is mocked rather than run: it is a signed bundle that talks to
 * fileproviderd, and loading the real module pulls in Electron.
 */
const calls: string[][] = []
let fails = false

mock.module('./agent', () => ({
  agentInstalled: () => true,
  runAgent: async (args: string[]) => {
    calls.push(args)
    if (fails) throw new Error('helper refused')
    // start() re-reads the list to confirm the registration stuck.
    if (args[0] === 'list') return { ok: true, domains: ['sia-dev'] }
    return { ok: true }
  },
}))

const { createDarwinIntegration } = await import('./darwin')

async function mounted() {
  const platform = createDarwinIntegration()
  await platform.start({
    domainId: 'sia-dev',
    displayName: 'Sia',
    paths: {} as never,
  } as never)
  calls.length = 0
  return platform
}

describe('stopping the mount', () => {
  beforeEach(() => {
    calls.length = 0
    fails = false
  })

  it('removes the mount when signing out, so the system deletes its copy', async () => {
    const platform = await mounted()

    await platform.stop({ remove: true })

    expect(calls).toEqual([['unregister', 'sia-dev']])
  })

  it('only hides the mount when quitting, so a relaunch keeps downloaded files', async () => {
    const platform = await mounted()

    await platform.stop()

    expect(calls).toEqual([['hide', 'sia-dev']])
  })

  it('still reports the mount when the helper refuses, so the wipe is held', async () => {
    const platform = await mounted()
    fails = true

    await platform.stop({ remove: true })

    // Reporting absent here would let the library wipe run while the system
    // still holds its copy of this account's files.
    expect(platform.status()).not.toBe('absent')
  })
})
