import type { IpcConnection } from '@siastorage/node-adapters'
import type { CliApp } from '../../src/app'
import type { IpcHandlerMap } from '../../src/daemon/ipc/index'
import { registerStatusHandlers } from '../../src/daemon/ipc/status'
import { createMaterializing } from '../../src/daemon/materializing'

/*
 * The desktop app asks a running daemon which build it is and what started
 * it, and replaces one it does not recognise as its own.
 */
describe('the daemon version call', () => {
  const inheritedStarter = process.env.SIA_DAEMON_STARTED_BY
  const build = globalThis as { SIA_DAEMON_BUILD?: string }
  let version: () => Promise<unknown>

  beforeEach(() => {
    const handlers: IpcHandlerMap = new Map()
    // The version call reads nothing from the app.
    registerStatusHandlers(handlers, {} as CliApp, () => {}, createMaterializing())
    version = () => handlers.get('version')!({}, {} as IpcConnection)
  })

  afterEach(() => {
    delete build.SIA_DAEMON_BUILD
    if (inheritedStarter === undefined) delete process.env.SIA_DAEMON_STARTED_BY
    else process.env.SIA_DAEMON_STARTED_BY = inheritedStarter
  })

  it('reports the build the desktop app stamped and that the app started it', async () => {
    build.SIA_DAEMON_BUILD = '0.0.2+7.abc1234.k2j4x9q1'
    process.env.SIA_DAEMON_STARTED_BY = 'desktop'

    expect(await version()).toMatchObject({
      build: '0.0.2+7.abc1234.k2j4x9q1',
      pid: process.pid,
      startedBy: 'desktop',
    })
  })

  it('reports no build and a terminal start outside the desktop app', async () => {
    delete process.env.SIA_DAEMON_STARTED_BY

    expect(await version()).toMatchObject({ build: null, startedBy: 'cli' })
  })
})
