import { afterAll, describe, expect, test } from 'bun:test'
import { WindowsDevice } from '../src/devices/windows'
import { Session } from '../src/session'

/*
 * A session waiting for the Windows VM's desktop runs no lease of its own, and
 * a `down` there calls stop on its device. The VM is never reached here: the
 * device's host is swapped for one that records each call.
 */

describe('a Windows device whose session does not hold the VM', () => {
  const session = Session.create('windows-unit-waiting', { fastTimers: true })
  afterAll(() => session.remove())

  test('sends no shutdown or kill, which would stop the session using the VM', async () => {
    const calls: string[] = []
    const record = (name: string) => async () => {
      calls.push(name)
      return {}
    }
    const device = new WindowsDevice('win', session)
    Object.assign(device, {
      host: {
        vm: { state: async () => (calls.push('state'), 'running') },
        attach: record('attach'),
        agent: record('agent'),
      },
    })

    await device.stop()
    await device.kill()

    expect(calls).toEqual([])
  })
})

describe('stopping a Windows device', () => {
  const session = Session.create('windows-unit-stopping', { fastTimers: true })
  afterAll(() => session.remove())

  test('kills nothing until the daemon process has exited, which it does after closing its pipe', async () => {
    const calls: string[] = []
    let polls = 0
    const device = new WindowsDevice('win', session)
    Object.assign(device, {
      holdsLease: () => true,
      host: {
        vm: { state: async () => 'running' },
        attach: async () => {},
        agent: async (path: string, body: { pid?: number }) => {
          calls.push(path === '/alive' ? `/alive ${body.pid}` : path)
          if (path === '/read') return { text: '4242' }
          if (path === '/alive') return { alive: ++polls < 3 }
          return {}
        },
      },
    })

    await device.stop()

    expect(calls).toEqual(['/read', '/ipc', '/alive 4242', '/alive 4242', '/alive 4242', '/kill'])
  })
})
