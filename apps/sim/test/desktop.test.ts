import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addDevice, type DesktopDevice } from '../src/devices'
import {
  desktopIdentity,
  desktopUnavailable,
  findMount,
  isPreservedCopy,
  parseEnvFile,
} from '../src/devices/desktop'
import { Session } from '../src/session'

const dirs: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sim-desktop-'))
  dirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('desktop devices', () => {
  test('the test context installs as Sia Storage Test with its own Finder folder', () => {
    expect(desktopIdentity('test')).toEqual({
      context: 'test',
      appName: 'Sia Storage Test',
      domainId: 'sia-test',
      domainDisplay: 'Sia Storage Test',
      appPath: '/Applications/Sia Storage Test.app',
    })
  })

  test("a context's local env file wins over its example", () => {
    const dir = scratch()
    writeFileSync(join(dir, 'x.example.env'), '# note\nSIA_APP_NAME=Example\nSIA_DOMAIN_ID=ex\n')
    writeFileSync(join(dir, 'x.env'), 'SIA_APP_NAME=Local\n')
    const identity = desktopIdentity('x', dir)
    expect(identity.appName).toBe('Local')
    expect(identity.domainId).toBe('ex')
  })

  test('env files skip comments and blank lines', () => {
    expect(parseEnvFile('# A=1\n\nB=two words\n  C=3  \n')).toEqual({ B: 'two words', C: '3' })
  })

  test('the Finder folder is found by its display name, not a copy the system preserved', () => {
    const root = scratch()
    mkdirSync(join(root, 'SiaStorageTest-SiaStorageTest (9-25-26 10:25 AM)'))
    expect(findMount('Sia Storage Test', root)).toBeNull()
    mkdirSync(join(root, 'SiaStorageTest-SiaStorageTest'))
    expect(findMount('Sia Storage Test', root)).toBe(join(root, 'SiaStorageTest-SiaStorageTest'))
  })

  test('only the dated copy beside the Finder folder counts as one macOS preserved', () => {
    const root = '/Users/x/Library/CloudStorage'
    const copy = `${root}/SiaStorageTest-SiaStorageTest (9-25-26 10:25 AM)`
    expect(isPreservedCopy(copy, 'Sia Storage Test', root)).toBe(true)
    expect(isPreservedCopy(`${root}/SiaStorageTest-SiaStorageTest`, 'Sia Storage Test', root)).toBe(
      false,
    )
    expect(isPreservedCopy(root, 'Sia Storage Test', root)).toBe(false)
    expect(isPreservedCopy('/Users/x', 'Sia Storage Test', root)).toBe(false)
    expect(isPreservedCopy(`${root}/Other-Other (9-25-26)`, 'Sia Storage Test', root)).toBe(false)
  })

  test.skipIf(process.platform !== 'darwin')('a build that is not installed is unavailable', () => {
    const identity = { ...desktopIdentity('test'), appPath: join(scratch(), 'Missing.app') }
    expect(desktopUnavailable(identity)).toContain('is not installed')
  })

  test('a session takes one desktop device, since the test build has one Finder folder', async () => {
    const session = Session.create(`desktop-test-${crypto.randomUUID().slice(0, 8)}`, {
      fastTimers: true,
    })
    try {
      await addDevice(session, 'mac', 'desktop')
      await expect(addDevice(session, 'mac2', 'desktop')).rejects.toThrow(
        'already has a desktop device, mac',
      )
    } finally {
      session.remove()
    }
  })

  test('the prod and beta builds are refused, since a device quits its build', () => {
    expect(() => desktopIdentity('prod')).toThrow('SIM_DESKTOP_CONTEXT=prod')
    expect(() => desktopIdentity('beta')).toThrow('SIM_DESKTOP_CONTEXT=beta')
  })
})

describe('a desktop device added signed out', () => {
  const session = Session.create(`unit-signed-out-${process.pid}`, { fastTimers: true })
  // A session takes one desktop device, so the one added plainly has its own.
  const plain = Session.create(`unit-signed-in-${process.pid}`, { fastTimers: true })
  afterAll(() => {
    session.remove()
    plain.remove()
  })

  test('is recorded as starting with no account, and one added plainly is not', async () => {
    const signedOut = await addDevice(session, 'mac', 'desktop', { signedOut: true })
    const signedIn = await addDevice(plain, 'mac', 'desktop')

    expect((signedOut as DesktopDevice).signedOut).toBe(true)
    expect((signedIn as DesktopDevice).signedOut).toBe(false)
    expect(Session.load(session.name)?.state.devices.mac.signedOut).toBe(true)
  })

  test('no other kind of device can be', async () => {
    await expect(addDevice(session, 'laptop', 'cli', { signedOut: true })).rejects.toThrow(
      'Only a desktop device can start signed out',
    )
    expect(session.state.devices.laptop).toBeUndefined()
  })
})
