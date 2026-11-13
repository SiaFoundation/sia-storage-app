import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  createFinderAgent,
  parseEvictResults,
  parseMaterialized,
  parseResendResults,
} from '../../src/daemon/finderAgent'

/**
 * Running the app's Finder agent from the daemon. `exec` stands in for
 * `codesign` and the agent, so these cover what the daemon checks and how it
 * reads the answer. The agent itself is tested in Swift.
 */
describe('the Finder agent runner', () => {
  let dir: string
  let agentPath: string
  const domain = () => ({ id: 'sia-dev', adapterConfig: agentPath })

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finder-agent-'))
    agentPath = path.join(dir, 'Sia Storage Finder Agent')
    fs.writeFileSync(agentPath, 'agent')
  })

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  /** A signed agent that evicts everything except the ids in `busy`. */
  function fakeExec(opts: { identifier?: string; busy?: string[] } = {}) {
    const calls: string[][] = []
    const exec = async (file: string, args: string[]) => {
      calls.push([file, ...args])
      if (file === '/usr/bin/codesign') {
        const identifier = opts.identifier ?? 'sia.storage.desktop.dev.finder-agent'
        return { stdout: '', stderr: `Executable=${agentPath}\nIdentifier=${identifier}\n` }
      }
      const [verb, , out, ...ids] = args
      if (verb === 'materialized') {
        const answer =
          ids.length > 0 ? { anchor: 'next', removed: ['gone'] } : { anchor: 'first', full: ['a'] }
        fs.writeFileSync(out, JSON.stringify(answer))
        return { stdout: '{"ok":true}', stderr: '' }
      }
      const results = ids.map((id) => ({
        id,
        result: opts.busy?.includes(id) ? 'busy' : 'evicted',
      }))
      fs.writeFileSync(out, JSON.stringify({ results }))
      return { stdout: '{"ok":true}', stderr: '' }
    }
    return { exec, calls }
  }

  it("reads each item's result from the file the agent wrote", async () => {
    const { exec } = fakeExec({ busy: ['b'] })

    const results = await createFinderAgent({ exec }).dehydrate(domain(), ['a', 'b'])

    expect(results).toEqual({ a: 'done', b: 'busy' })
  })

  it('refuses to run a program not signed as a Finder agent', async () => {
    const { exec, calls } = fakeExec({ identifier: 'com.apple.rm' })

    await expect(createFinderAgent({ exec }).changes(domain(), null)).rejects.toThrow(
      'Finder could not list its downloads now',
    )
    expect(calls.some(([file]) => file === agentPath)).toBe(false)
  })

  it('checks the signature again only once the file changes', async () => {
    const { exec, calls } = fakeExec()
    const agent = createFinderAgent({ exec })
    const verifications = () => calls.filter(([, flag]) => flag === '--verify').length

    await agent.changes(domain(), null)
    await agent.changes(domain(), 'first')
    expect(verifications()).toBe(1)

    // An app update replaces the agent in place.
    fs.writeFileSync(agentPath, 'a newer agent')
    await agent.changes(domain(), 'next')
    expect(verifications()).toBe(2)
  })

  it('rejects with text naming no path or anchor when the agent fails', async () => {
    const { exec } = fakeExec()
    const failing = async (file: string, args: string[]) => {
      if (file === agentPath) {
        throw new Error(`Command failed: ${agentPath} materialized sia-dev /tmp/out.json anchor-a`)
      }
      return exec(file, args)
    }

    const error = await createFinderAgent({ exec: failing })
      .changes(domain(), 'anchor-a')
      .catch((e: Error) => e)

    expect((error as Error).message).toBe('Finder could not list its downloads now')
  })

  it('reads every answer but evicted and refused as busy, and skips entries without an id', () => {
    expect(
      parseEvictResults(
        JSON.stringify({
          results: [
            { id: 'a', result: 'linked' },
            { id: 'b', result: 'unsynced' },
            { id: 'c', result: 'gone' },
            { id: 'd', result: 'refused' },
            { result: 'evicted' },
          ],
        }),
      ),
    ).toEqual({ a: 'busy', b: 'busy', c: 'busy', d: 'refused' })
  })

  it('reads a resend as asked, not hydrated or failed', () => {
    expect(
      parseResendResults(
        JSON.stringify({
          results: [
            { id: 'a', result: 'asked' },
            { id: 'b', result: 'not-hydrated' },
            { id: 'c', result: 'noSuchItem' },
          ],
        }),
      ),
    ).toEqual({ a: 'asked', b: 'not-hydrated', c: 'failed' })
  })

  it('rejects when the mount setting names no agent', async () => {
    const { exec } = fakeExec()

    await expect(createFinderAgent({ exec }).changes({ id: 'sia-dev' }, null)).rejects.toThrow(
      'Finder could not list its downloads now',
    )
  })

  it('reads the whole set with no anchor, and changes since one', async () => {
    const { exec, calls } = fakeExec()
    const agent = createFinderAgent({ exec })

    expect(await agent.changes(domain(), null)).toEqual({
      cursor: 'first',
      full: ['a'],
      added: undefined,
      removed: undefined,
    })
    expect((await agent.changes(domain(), 'first'))?.removed).toEqual(['gone'])
    expect(
      calls
        .filter(([file]) => file === agentPath)
        .map(([, verb, domainId, , ...rest]) => [verb, domainId, ...rest]),
    ).toEqual([
      ['materialized', 'sia-dev'],
      ['materialized', 'sia-dev', 'first'],
    ])
  })

  it('refuses an answer with no anchor, which would lose the place to read from', () => {
    expect(() => parseMaterialized(JSON.stringify({ full: ['a'] }))).toThrow(/no anchor/)
  })
})
