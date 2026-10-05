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
    registerStatusHandlers(handlers, app, () => {}, createMaterializing())
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
