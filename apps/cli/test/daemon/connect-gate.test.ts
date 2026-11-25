import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { syncDownEventsBatch } from '@siastorage/core/services/syncDownEvents'
import type { IpcConnection } from '@siastorage/node-adapters'
import { MockSdk } from '@siastorage/sdk-mock'
import type { CliApp } from '../../src/app'
import type { IpcHandlerMap } from '../../src/daemon/ipc/index'
import { registerStatusHandlers } from '../../src/daemon/ipc/status'
import { createMaterializing } from '../../src/daemon/materializing'
import { createSignIn } from '../../src/daemon/signIn'
import { createTestApp } from '../helpers'

/*
 * A client that signs in after the daemon is up shows the first sync as a
 * step. An account with nothing in it never reports `isSyncingDown`, so the
 * gate is the only thing that tells that sync apart from one not yet run.
 */
describe('signing in to a running daemon', () => {
  let tempDir: string
  let app: CliApp
  let connect: () => Promise<unknown>

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-cli-connect-gate-'))
    app = await createTestApp(tempDir)
    app.internal.setSdk(new MockSdk())
    const handlers: IpcHandlerMap = new Map()
    registerStatusHandlers(
      handlers,
      app,
      () => {},
      createMaterializing(),
      createSignIn(app, { delaysMs: [10] }),
    )
    connect = () => handlers.get('connect')!({}, {} as IpcConnection)
  })

  afterEach(() => {
    app.internal.events.dispose()
    app.db.close?.()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function connectsWith(connected: boolean) {
    app.bootstrap.connect = async (cli) => {
      cli.service.connection.setState({ isConnected: connected })
      return connected
    }
  }

  it('raises the first-sync gate', async () => {
    connectsWith(true)

    await connect()

    expect(app.service.sync.getState().syncGateStatus).toBe('pending')
  })

  it('dismisses the gate after a sync-down pass over an empty account', async () => {
    connectsWith(true)
    await connect()

    await syncDownEventsBatch(new AbortController().signal, app.service, app.internal)

    expect(app.service.sync.getState().isSyncingDown).toBe(false)
    expect(app.service.sync.getState().syncGateStatus).toBe('dismissed')
  })

  it('raises the gate when the first attempt could not reach the indexer and a retry connects', async () => {
    let attempts = 0
    app.bootstrap.connect = async (cli) => {
      attempts += 1
      if (attempts === 1) throw new Error('error sending request: connection refused')
      cli.service.connection.setState({ isConnected: true })
      return true
    }

    expect(await connect()).toEqual({ connected: false })
    const deadline = Date.now() + 2_000
    while (!app.service.connection.getState().isConnected && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5))
    }

    expect(app.service.sync.getState().syncGateStatus).toBe('pending')
  })

  it('leaves the gate down when the connection fails', async () => {
    connectsWith(false)

    await connect()

    expect(app.service.sync.getState().syncGateStatus).toBe('idle')
  })

  it('leaves the gate down for a daemon that was already connected', async () => {
    connectsWith(true)
    app.service.connection.setState({ isConnected: true })

    await connect()

    expect(app.service.sync.getState().syncGateStatus).toBe('idle')
  })
})
