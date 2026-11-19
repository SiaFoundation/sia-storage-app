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

describe("a Windows device's File Explorer folder", () => {
  const session = Session.create('windows-unit-folder', { fastTimers: true })
  afterAll(() => session.remove())

  /** A device whose agent answers `attrib` with `letters` for any file, and records what each command was given. */
  function deviceWith(letters: string, exitCode = 0) {
    const chosen: Array<Record<string, string> | undefined> = []
    const device = new WindowsDevice('win', session)
    Object.assign(device, {
      host: {
        agent: async (_path: string, body: { command: string[]; env?: Record<string, string> }) => {
          chosen.push(body.env)
          return { exitCode, stderr: '', stdout: `${letters}  ${body.command.at(-1)}\r\n` }
        },
      },
    })
    return { device, chosen }
  }

  test("names a file by the folder in the test account's profile, with Windows separators", () => {
    const { device } = deviceWith('')
    expect(device.explorerPath('docs/a.txt')).toBe(
      'C:\\Users\\siatest\\Sia Storage Dev\\docs\\a.txt',
    )
  })

  test('reads a file as not on the PC from the offline attribute', async () => {
    expect(await deviceWith('A      O').device.isCloudOnly('a.txt')).toBe(true)
    expect(await deviceWith('A       ').device.isCloudOnly('a.txt')).toBe(false)
  })

  test("frees and keeps a file by the commands of File Explorer's own menu", async () => {
    const { device, chosen } = deviceWith('A')
    const file = device.explorerPath('docs/a.txt')

    await device.freeUpSpace('docs/a.txt')
    await device.keepOnDevice('docs/a.txt')

    expect(chosen).toEqual([
      { SIM_FILE: file, SIM_COMMAND: 'Free up space' },
      { SIM_FILE: file, SIM_COMMAND: 'Always keep on this device' },
    ])
  })

  test('says so when the menu has no such command for the file', async () => {
    const { device } = deviceWith('A', 1)
    await expect(device.keepOnDevice('a.txt')).rejects.toThrow(/menu has no "Always keep/)
  })

  test('says so when attrib cannot find the file', async () => {
    const device = new WindowsDevice('win', session)
    Object.assign(device, {
      host: { agent: async () => ({ stdout: 'File not found - a.txt\r\n' }) },
    })
    await expect(device.isCloudOnly('a.txt')).rejects.toThrow(/attrib a.txt failed/)
  })
})
