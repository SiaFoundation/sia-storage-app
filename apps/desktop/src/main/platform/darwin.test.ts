import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * Covers which helper command each kind of stop runs. Signing out and quitting
 * differ in exactly one way that matters, and getting it wrong leaves the
 * account's file names and downloaded contents in the system's copy. Also
 * covers which domain and agent the daemon is told about.
 *
 * The helper is mocked rather than run: it is a signed bundle that talks to
 * fileproviderd, and loading the real module pulls in Electron.
 */
const calls: string[][] = []
let fails = false
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

  it('names none once quitting has hidden the mount', async () => {
    writeFileSync(finderAgent, '')
    const platform = await mounted()

    await platform.stop()

    expect(platform.mount()).toBeNull()
  })
})
