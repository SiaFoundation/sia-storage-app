import { describe, expect, test } from 'bun:test'
import type { NetworkControl } from '@siastorage/mock-network/control'
import type { Device } from '../src/devices'
import type { CheckRecord } from '../src/scenario'
import { recordStandardChecks } from '../src/standard'

/** A device with an empty library, whose answers a test can override. */
function fakeDevice(
  over: { running?: boolean; downloads?: Record<string, { status: string }> } = {},
) {
  return {
    name: 'laptop',
    kind: 'cli',
    isRunning: async () => over.running ?? true,
    call: async (method: string) => {
      if (method === 'downloads.getState') return { downloads: over.downloads ?? {} }
      if (method === 'fs.listFiles') return []
      throw new Error(`unexpected call ${method}`)
    },
    sql: async () => [],
    library: async () => [],
  } as unknown as Device
}

const network = { objects: async () => [] } as unknown as NetworkControl

describe('recordStandardChecks', () => {
  test('a device that died stops the checks that would read it', async () => {
    const checks: CheckRecord[] = []
    await recordStandardChecks({
      devices: { laptop: fakeDevice({ running: false }) },
      network,
      checks,
    })
    expect(checks).toEqual([
      {
        label: 'laptop is still running at the end',
        ok: false,
        detail: 'expected true, got false',
        actual: false,
      },
    ])
  })

  test('every standard check passes on a device with nothing left to do', async () => {
    const checks: CheckRecord[] = []
    await recordStandardChecks({ devices: { laptop: fakeDevice() }, network, checks })
    expect(checks.every((c) => c.ok)).toBe(true)
    expect(checks.map((c) => c.label)).toEqual([
      'laptop is still running at the end',
      'laptop has no download left queued or downloading',
      'laptop has no import left in progress',
      'no file’s bytes are pinned twice',
      'every pinned object belongs to a file on a device',
      'laptop has the bytes of every file it records as local',
    ])
  })

  test('a skipped check is not run, and a label the scenario recorded is not recorded again', async () => {
    const checks: CheckRecord[] = [{ label: 'no file’s bytes are pinned twice', ok: true }]
    await recordStandardChecks({
      devices: { laptop: fakeDevice() },
      network,
      checks,
      skip: { importsSettle: 'the scenario ends with an import running' },
    })
    const labels = checks.map((c) => c.label)
    expect(labels).not.toContain('laptop has no import left in progress')
    expect(labels.filter((l) => l === 'no file’s bytes are pinned twice')).toHaveLength(1)
  })

  test('a download left queued is recorded with its file', async () => {
    const checks: CheckRecord[] = []
    await recordStandardChecks({
      devices: { laptop: fakeDevice({ downloads: { f1: { status: 'queued' } } }) },
      network,
      checks,
      skip: { importsSettle: 'not under test' },
      settleMs: 1500,
    })
    expect(checks.find((c) => c.label.includes('download'))).toMatchObject({
      ok: false,
      actual: ['f1'],
    })
  })
})
