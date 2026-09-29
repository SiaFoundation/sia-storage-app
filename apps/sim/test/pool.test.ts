import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DevicePool } from '../src/pool'
import { sessionDir } from '../src/session'

// A lease counts only while its session's directory exists.
const session = `pool-test-${process.pid}`
mkdirSync(sessionDir(session), { recursive: true })
const dirs: string[] = []

afterAll(() => {
  rmSync(sessionDir(session), { recursive: true, force: true })
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

async function poolWith(target: string): Promise<{ pool: DevicePool; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'sim-pool-'))
  dirs.push(dir)
  const pool = new DevicePool(dir)
  await pool.lease(session, [], async (adopt) => {
    adopt(target)
    return target
  })
  return { pool, dir }
}

describe('DevicePool', () => {
  test('a device handed back is idle only once the idle time has passed', async () => {
    const { pool, dir } = await poolWith('d1')
    pool.release('d1')
    expect(pool.idle(60_000)).toEqual([])
    const past = new Date(Date.now() - 120_000)
    utimesSync(join(dir, 'd1.member'), past, past)
    expect(pool.idle(60_000)).toEqual(['d1'])
  })

  test('a held device is never idle and keeps the pool busy', async () => {
    const { pool } = await poolWith('d1')
    expect(pool.idle(0)).toEqual([])
    expect(pool.busy(0)).toBe(true)
  })

  test('a device handed back recently keeps the pool busy', async () => {
    const { pool } = await poolWith('d1')
    pool.release('d1')
    expect(pool.busy(60_000)).toBe(true)
  })

  test('a device marked off is neither idle nor busy', async () => {
    const { pool } = await poolWith('d1')
    pool.release('d1')
    pool.markOff('d1')
    expect(pool.idle(0)).toEqual([])
    expect(pool.busy(60_000)).toBe(false)
  })

  test('a free member that fails keep is forgotten, not handed out', async () => {
    const { pool } = await poolWith('d1')
    pool.release('d1')
    const leased = await pool.lease(
      session,
      ['d1'],
      async (adopt) => {
        adopt('d2')
        return 'd2'
      },
      (target) => target !== 'd1',
    )
    expect(leased).toBe('d2')
    expect(pool.members()).toEqual(['d2'])
  })

  test('a lease with no free device and nothing to create returns null', async () => {
    const { pool } = await poolWith('d1')
    expect(await pool.lease(session, ['d1'], null)).toBeNull()
  })
})
