import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SystemStatus } from './loginItem'

/*
 * The login item against a stand-in for the system's registration, which
 * records each change and reports whatever status the test gives it.
 */

// Set before the imports: the logger fixes its file path when it loads, and
// without this it would write into a real library directory.
const inheritedDataDir = process.env.SIA_DATA_DIR
const dir = mkdtempSync(join(tmpdir(), 'desktop-login-item-'))
process.env.SIA_DATA_DIR = dir

mock.module('electron', () => ({
  app: { getName: () => 'sia.storage.desktop.dev', isPackaged: false },
}))

const { createLoginItem, enabledByDefault } = await import('./loginItem')

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  if (inheritedDataDir === undefined) delete process.env.SIA_DATA_DIR
  else process.env.SIA_DATA_DIR = inheritedDataDir
})

const choiceFile = join(dir, 'open-at-login.json')

function fakeSystem(initial: SystemStatus = 'not-registered') {
  const fake = {
    current: initial,
    /** What `set` changes the status to, so a test can stand in for a refusal. */
    onSet: (on: boolean): SystemStatus => (on ? 'enabled' : 'not-registered'),
    sets: [] as boolean[],
    settingsOpened: 0,
    status: () => fake.current,
    set: (on: boolean) => {
      fake.sets.push(on)
      fake.current = fake.onSet(on)
    },
    openSettings: () => {
      fake.settingsOpened++
    },
  }
  return fake
}

const hasAccount = async () => true
const noAccount = async () => false

beforeEach(() => rmSync(choiceFile, { force: true }))

describe('enabledByDefault', () => {
  it('turns it on for the beta and shipping builds only', () => {
    expect(enabledByDefault('prod')).toBe(true)
    expect(enabledByDefault('beta')).toBe(true)
    expect(enabledByDefault('dev')).toBe(false)
    expect(enabledByDefault('test')).toBe(false)
  })
})

describe('status', () => {
  it('reads not-found as off and requires-approval as needing approval', () => {
    const system = fakeSystem('not-found')
    const item = createLoginItem({ system, enableByDefault: true, choiceFile })
    expect(item.status()).toBe('off')
    system.current = 'requires-approval'
    expect(item.status()).toBe('needs-approval')
    system.current = 'enabled'
    expect(item.status()).toBe('on')
  })
})

describe('applyDefault', () => {
  it('turns the login item on the first time the Mac has an account', async () => {
    const system = fakeSystem()
    const item = createLoginItem({ system, enableByDefault: true, choiceFile })
    await item.applyDefault(hasAccount)
    expect(system.sets).toEqual([true])
    expect(item.status()).toBe('on')
    expect(existsSync(choiceFile)).toBe(true)
  })

  it('waits for an account before turning anything on', async () => {
    const system = fakeSystem()
    const item = createLoginItem({ system, enableByDefault: true, choiceFile })
    await item.applyDefault(noAccount)
    expect(system.sets).toEqual([])
    expect(existsSync(choiceFile)).toBe(false)
  })

  it('leaves a login item the user turned off alone', async () => {
    const system = fakeSystem('enabled')
    const item = createLoginItem({ system, enableByDefault: true, choiceFile })
    item.set(false)
    await item.applyDefault(hasAccount)
    expect(system.sets).toEqual([false])
    expect(item.status()).toBe('off')
  })

  it('leaves the switch off when the user turns it off while the account check is pending', async () => {
    const system = fakeSystem()
    const item = createLoginItem({ system, enableByDefault: true, choiceFile })
    const account = Promise.withResolvers<boolean>()
    const applying = item.applyDefault(() => account.promise)
    item.set(false)
    account.resolve(true)
    await applying
    expect(system.sets).toEqual([false])
    expect(item.status()).toBe('off')
  })

  it('asks for the account only while the default is still to apply', async () => {
    const system = fakeSystem()
    const item = createLoginItem({ system, enableByDefault: true, choiceFile })
    const asked = mock(hasAccount)
    await item.applyDefault(asked)
    await item.applyDefault(asked)
    expect(asked).toHaveBeenCalledTimes(1)
  })

  it('does nothing in a build that does not default to it', async () => {
    const system = fakeSystem()
    const asked = mock(hasAccount)
    const item = createLoginItem({ system, enableByDefault: false, choiceFile })
    await item.applyDefault(asked)
    expect(asked).not.toHaveBeenCalled()
    expect(system.sets).toEqual([])
  })

  it('does not register again over a login item turned off in System Settings', async () => {
    const system = fakeSystem('requires-approval')
    const item = createLoginItem({ system, enableByDefault: true, choiceFile })
    await item.applyDefault(hasAccount)
    expect(system.sets).toEqual([])
    expect(system.settingsOpened).toBe(0)
  })
})

describe('set', () => {
  it('answers with the status the system reports after the change', () => {
    const system = fakeSystem()
    system.onSet = () => 'not-found'
    const item = createLoginItem({ system, enableByDefault: false, choiceFile })
    expect(item.set(true)).toBe('off')
  })

  it('opens System Settings when turning on a login item the user turned off there', () => {
    const system = fakeSystem('requires-approval')
    system.onSet = () => 'requires-approval'
    const item = createLoginItem({ system, enableByDefault: false, choiceFile })
    expect(item.set(true)).toBe('needs-approval')
    expect(system.settingsOpened).toBe(1)
  })
})
