import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { executeShutdown, type ShutdownContext } from '../../src/daemon/lifecycle'

/*
 * The daemon's shutdown when two requests arrive close together, as when the
 * desktop app quits for an update and its next launch asks the same daemon to
 * make way.
 */
describe('daemon shutdown', () => {
  it('runs once when a second request arrives while uploads are still draining', async () => {
    const steps: string[] = []
    let drain!: () => void
    const drained = new Promise<void>((resolve) => (drain = resolve))
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sia-shutdown-')), 'state')
    const ctx = {
      app: {
        service: {
          uploader: {
            shutdown: () => {
              steps.push('drain uploads')
              return drained
            },
          },
        },
        internal: { events: { dispose: () => steps.push('dispose events') } },
        db: {
          finalize: async () => {
            steps.push('finalize database')
          },
          close: () => steps.push('close database'),
        },
        paths: { statePath },
      },
      scheduler: {
        shutdown: async () => {
          steps.push('stop scheduler')
        },
      },
      ipcServer: { close: () => steps.push('close socket') },
      lock: { release: () => steps.push('release lock') },
    } as unknown as ShutdownContext

    try {
      const first = executeShutdown(ctx)
      const second = executeShutdown(ctx)
      drain()
      await Promise.all([first, second])

      expect(steps).toEqual([
        'drain uploads',
        'dispose events',
        'stop scheduler',
        'close socket',
        'finalize database',
        'close database',
        'release lock',
      ])
      expect(exit).toHaveBeenCalledTimes(1)
    } finally {
      exit.mockRestore()
    }
  })
})
