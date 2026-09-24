import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * Whether startup discards Finder's folder: only when the daemon about to
 * start will rebuild a library that exists.
 */
let appName = 'sia.storage.desktop.beta'
mock.module('electron', () => ({ app: { getName: () => appName } }))

const { forcedResetPending } = await import('./forcedReset')

const inheritedDataDir = process.env.SIA_DATA_DIR
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'desktop-reset-'))
  process.env.SIA_DATA_DIR = dir
  appName = 'sia.storage.desktop.beta'
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (inheritedDataDir === undefined) delete process.env.SIA_DATA_DIR
  else process.env.SIA_DATA_DIR = inheritedDataDir
})

describe('a pending forced reset', () => {
  it('is pending for a beta library that has not recorded the nonce', async () => {
    writeFileSync(join(dir, 'data.db'), '')

    expect(await forcedResetPending()).toBe(true)
  })

  it('is not pending once the library records the nonce, or before one exists', async () => {
    writeFileSync(join(dir, 'storage.json'), '{}')
    expect(await forcedResetPending()).toBe(false)

    writeFileSync(join(dir, 'data.db'), '')
    const { recordForcedReset } = await import('@siastorage/core/lib/forcedReset')
    const stored: Record<string, string> = {}
    await recordForcedReset({ setItem: async (k, v) => void (stored[k] = v) }, 'beta')
    writeFileSync(join(dir, 'storage.json'), JSON.stringify(stored))
    expect(await forcedResetPending()).toBe(false)
  })

  it('is not pending for the shipping build while its nonce is unset', async () => {
    appName = 'sia.storage.desktop'
    writeFileSync(join(dir, 'data.db'), '')

    expect(await forcedResetPending()).toBe(false)
  })
})
