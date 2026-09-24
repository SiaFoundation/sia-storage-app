import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'

/*
 * Which library each build context reads. The three install side by side, so
 * sharing one directory would put them on one database, one socket and one
 * account.
 */
let appName = 'sia.storage.desktop'

mock.module('electron', () => ({ app: { getName: () => appName } }))

const { buildVariant, dataDir, daemonSocketPath } = await import('./paths')

// An inherited SIA_DATA_DIR would fail the default-path tests below, and
// deleting it outright would change the environment every later suite in
// this process runs against, so it is saved, cleared, and put back.
const inheritedDataDir = process.env.SIA_DATA_DIR

beforeEach(() => {
  delete process.env.SIA_DATA_DIR
})

afterEach(() => {
  if (inheritedDataDir === undefined) delete process.env.SIA_DATA_DIR
  else process.env.SIA_DATA_DIR = inheritedDataDir
})

describe('the build variant the daemon is told', () => {
  it('names each signed context, and a source checkout as dev', () => {
    const variants = [
      'sia.storage.desktop',
      'sia.storage.desktop.beta',
      'sia.storage.desktop.dev',
      '@siastorage/desktop',
    ].map((name) => {
      appName = name
      return buildVariant()
    })

    expect(variants).toEqual(['prod', 'beta', 'dev', 'dev'])
  })
})

describe('the library directory', () => {
  it('is the plain one for the shipping build, which the CLI also uses', () => {
    appName = 'sia.storage.desktop'

    expect(dataDir()).toBe(join(homedir(), '.sia'))
  })

  it('is separate for beta', () => {
    appName = 'sia.storage.desktop.beta'

    expect(dataDir()).toBe(join(homedir(), '.sia-beta'))
  })

  it('is separate for dev', () => {
    appName = 'sia.storage.desktop.dev'

    expect(dataDir()).toBe(join(homedir(), '.sia-dev'))
  })

  it('is the development one for a source checkout', () => {
    appName = '@siastorage/desktop'

    expect(dataDir()).toBe(join(homedir(), '.sia-dev'))
  })

  it('is whatever SIA_DATA_DIR says, for a scratch library', () => {
    appName = 'sia.storage.desktop.beta'
    process.env.SIA_DATA_DIR = '/tmp/scratch-library'

    expect(dataDir()).toBe('/tmp/scratch-library')
  })

  it('puts each context on its own socket, so one daemon cannot serve two', () => {
    appName = 'sia.storage.desktop.beta'
    const beta = daemonSocketPath()
    appName = 'sia.storage.desktop'

    expect(daemonSocketPath()).not.toBe(beta)
  })
})
