import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Sdk } from '@siafoundation/sia-storage'
import type { CliApp } from '../../src/app'
import { createSignIn } from '../../src/daemon/signIn'
import { createTestApp } from '../helpers'

describe('the daemon signing in to the indexer', () => {
  let tempDir: string
  let app: CliApp
  let calls: number

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cli-sign-in-'))
    app = await createTestApp(tempDir)
    calls = 0
  })

  afterEach(() => {
    app.internal.events.dispose()
    app.db.close?.()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  /** A connect that throws until `up()` is called, as the SDK does with no network. */
  function network() {
    let reachable = false
    const connect = async (cli: CliApp) => {
      calls += 1
      if (!reachable) throw new Error('error sending request: connection refused')
      cli.service.connection.setState({ isConnected: true, connectionError: null })
      return true
    }
    return { connect, up: () => (reachable = true) }
  }

  async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('timed out')
      await new Promise((r) => setTimeout(r, 5))
    }
  }

  it('keeps trying while the indexer cannot be reached, and stops once signed in', async () => {
    const net = network()
    const signIn = createSignIn(app, { connect: net.connect, delaysMs: [10, 20] })

    signIn.start()
    await until(() => calls >= 3)
    expect(app.service.connection.getState().isConnected).toBe(false)

    net.up()
    await until(() => app.service.connection.getState().isConnected)
    const settled = calls
    await new Promise((r) => setTimeout(r, 60))
    expect(calls).toBe(settled)
    signIn.stop()
  })

  it('does not retry an attempt that found no account', async () => {
    const signIn = createSignIn(app, {
      connect: async () => {
        calls += 1
        return false
      },
      delaysMs: [10],
    })

    signIn.start()
    await new Promise((r) => setTimeout(r, 60))

    expect(calls).toBe(1)
    signIn.stop()
  })

  it('makes one attempt for two callers asking at once', async () => {
    let release!: () => void
    const signIn = createSignIn(app, {
      connect: async (cli) => {
        calls += 1
        await new Promise<void>((r) => (release = r))
        cli.service.connection.setState({ isConnected: true, connectionError: null })
        return true
      },
    })

    const first = signIn.attempt()
    const second = signIn.attempt()
    release()

    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(calls).toBe(1)
  })

  it('retries a sign-in that failed for want of a network, whoever asked for it', async () => {
    const net = network()
    const signIn = createSignIn(app, { connect: net.connect, delaysMs: [10] })

    expect(await signIn.attempt()).toBe(false)
    net.up()

    await until(() => app.service.connection.getState().isConnected)
    signIn.stop()
  })

  it('does not take effect when an attempt waiting on the indexer finishes after stop', async () => {
    let release!: () => void
    const signIn = createSignIn(app, {
      // As both bootstraps do: check the signal once the network wait is over.
      connect: async (cli, signal) => {
        calls += 1
        await new Promise<void>((r) => (release = r))
        if (signal.aborted) return false
        cli.service.connection.setState({ isConnected: true, connectionError: null })
        return true
      },
    })

    const attempt = signIn.attempt()
    signIn.stop()
    release()

    expect(await attempt).toBe(false)
    expect(app.service.connection.getState().isConnected).toBe(false)
  })

  it('the real bootstrap attaches nothing for a connect that returns after its signal was aborted', async () => {
    const indexerURL = await app.service.settings.getIndexerURL()
    await app.service.auth.setAppKey(indexerURL, new Uint8Array(32).fill(1))
    app.bootstrap.sdkAuth.adapters.connectWithKey = async () => true
    app.bootstrap.sdkAuth.getLastSdk = () => new Sdk() as never
    const aborted = new AbortController()
    aborted.abort()

    expect(await app.bootstrap.connect(app, aborted.signal)).toBe(false)
    expect(app.service.connection.getState().isConnected).toBe(false)
    expect(await app.bootstrap.connect(app, new AbortController().signal)).toBe(true)
  })

  it('makes no attempt after it is stopped', async () => {
    const net = network()
    const signIn = createSignIn(app, { connect: net.connect, delaysMs: [20] })

    signIn.start()
    await until(() => calls === 1)
    signIn.stop()
    await new Promise((r) => setTimeout(r, 60))

    expect(calls).toBe(1)
  })
})
