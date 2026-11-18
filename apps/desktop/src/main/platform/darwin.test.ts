import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * Covers which helper command each kind of stop runs. Signing out and quitting
 * differ in exactly one way that matters, and getting it wrong leaves the
 * account's file names and downloaded contents in the system's copy. Also
 * covers which domain and agent the daemon is told about, and registering
 * again when the system does not list the domain after a register.
 *
 * The helper is mocked rather than run: it is a signed bundle that talks to
 * fileproviderd, and loading the real module pulls in Electron.
 */
const calls: string[][] = []
let fails = false
let listFails = false
/** What each `list` answers, in order, before falling back to the registered domain. */
let listAnswers: string[][] = []
/** Stands in for the bare agent the packaging installs. Each test writes it or leaves it out. */
const agentDir = mkdtempSync(join(tmpdir(), 'darwin-test-'))
const finderAgent = join(agentDir, 'Sia Storage Finder Agent')
afterAll(() => rmSync(agentDir, { recursive: true, force: true }))

mock.module('./agent', () => ({
  agentInstalled: () => true,
  finderAgentPath: () => finderAgent,
  runAgent: async (args: string[]) => {
    calls.push(args)
    if (fails) throw new Error('helper refused')
    if (listFails && args[0] === 'list') throw new Error('helper refused')
    // start() re-reads the list to confirm the registration stuck.
    if (args[0] === 'list') return { ok: true, domains: listAnswers.shift() ?? ['sia-dev'] }
    return { ok: true }
  },
}))

const { createDarwinIntegration } = await import('./darwin')

const config = { domainId: 'sia-dev', displayName: 'Sia', shellSocket: '' }

async function mounted() {
  const platform = createDarwinIntegration()
  await platform.start(config)
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

  it('removes a mount it is not serving yet when discarding it before a reset', async () => {
    const platform = createDarwinIntegration()

    expect(await platform.discard('sia-dev')).toBe(true)
    expect(calls).toEqual([['unregister', 'sia-dev']])
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

describe('the Finder domain the daemon is told about', () => {
  beforeEach(() => {
    calls.length = 0
    fails = false
    listFails = false
    rmSync(finderAgent, { force: true })
  })

  it('names the registered domain and the bare agent once the mount is up', async () => {
    writeFileSync(finderAgent, '')
    const platform = await mounted()

    expect(platform.mount()).toEqual({ id: 'sia-dev', adapterConfig: finderAgent })
  })

  it('names none when this build has no bare agent', async () => {
    const platform = await mounted()

    expect(platform.mount()).toBeNull()
  })

  it('names the domain when it registered but the check that it stuck failed', async () => {
    writeFileSync(finderAgent, '')
    listFails = true
    const platform = await mounted()

    expect(platform.mount()).toEqual({ id: 'sia-dev', adapterConfig: finderAgent })
  })

  it('names none when registering failed', async () => {
    writeFileSync(finderAgent, '')
    fails = true
    const platform = await mounted()

    expect(platform.mount()).toBeNull()
  })

  it('names none once quitting has hidden the mount', async () => {
    writeFileSync(finderAgent, '')
    const platform = await mounted()

    await platform.stop()

    expect(platform.mount()).toBeNull()
  })
})

describe('a register the system does not keep', () => {
  beforeEach(() => {
    calls.length = 0
    fails = false
    listFails = false
    listAnswers = []
    writeFileSync(finderAgent, '')
  })

  it('registers again until the system lists the domain', async () => {
    listAnswers = [[], []]
    const platform = createDarwinIntegration([0, 0, 0])

    await platform.start(config)

    expect(calls).toEqual([
      ['register', 'sia-dev', 'Sia'],
      ['list'],
      ['register', 'sia-dev', 'Sia'],
      ['list'],
      ['register', 'sia-dev', 'Sia'],
      ['list'],
    ])
    expect(platform.status()).not.toBe('error')
    expect(platform.mount()).toEqual({ id: 'sia-dev', adapterConfig: finderAgent })
  })

  it('reports an error once every register has failed to stick', async () => {
    listAnswers = [[], [], []]
    const platform = createDarwinIntegration([0, 0])

    await platform.start(config)

    expect(calls.filter(([verb]) => verb === 'register')).toHaveLength(3)
    expect(platform.status()).toBe('error')
    expect(platform.mount()).toBeNull()
  })

  it('stops registering when the app quits while it waits to try again', async () => {
    listAnswers = [[]]
    const platform = createDarwinIntegration([60_000])

    const started = platform.start(config)
    // Lets the first register and list run, so the start is waiting to retry.
    while (calls.length < 2) await new Promise((resolve) => setTimeout(resolve, 1))
    await platform.stop()
    await started

    // A register after the hide would put the folder back in Finder with the
    // app gone.
    expect(calls).toEqual([['register', 'sia-dev', 'Sia'], ['list'], ['hide', 'sia-dev']])
    expect(platform.mount()).toBeNull()
  })
})
