import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  desktopHold,
  installedBuild,
  leaseHolder,
  releaseLease,
  releaseRunHolds,
  takeLease,
  withDesktopInstall,
} from '../src/desktop-lock'
import { waiters } from '../src/machine'
import { Session, SIM_HOME } from '../src/session'

const APP = 'Sia Storage Unit'
const fast = { intervalMs: 20, log: () => {} }
let n = 0

/** A context of its own per test, so no test sees another's lease or hold. */
const context = () => `unit${n++}`

async function session(name: string, owner?: string): Promise<Session> {
  const s = Session.create(name, { fastTimers: true })
  if (owner) {
    await s.update((state) => {
      state.owner = owner
    })
  }
  return s
}

/** Whether `promise` is still pending after `ms`. */
async function pending(promise: Promise<unknown>, ms = 150): Promise<boolean> {
  const marker = Symbol()
  return (
    (await Promise.race([promise.then(() => null), Bun.sleep(ms).then(() => marker)])) === marker
  )
}

describe('the desktop lease', () => {
  test('a second session waits for the first, saying which session holds the app', async () => {
    const ctx = context()
    await session('lease-a', 'checkout-a')
    await session('lease-b')
    await takeLease(ctx, APP, 'lease-a', fast)
    const second = takeLease(ctx, APP, 'lease-b', fast)
    expect(await pending(second)).toBe(true)
    expect(waiters().map((w) => w.blockedBy)).toEqual([
      'held by session lease-a from checkout checkout-a',
    ])
    releaseLease(ctx)
    await second
    expect(leaseHolder(ctx)).toBe('lease-b')
  })

  test('a session refuses to start while the app is being installed, naming the install', async () => {
    const ctx = context()
    await session('lease-c')
    let finish = () => {}
    const install = withDesktopInstall(
      ctx,
      APP,
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
      fast,
    )
    await Bun.sleep(50)
    await expect(takeLease(ctx, APP, 'lease-c', fast)).rejects.toThrow(
      /Sia Storage Unit is being installed by install Sia Storage Unit in checkout /,
    )
    finish()
    await install
    await takeLease(ctx, APP, 'lease-c', fast)
  })

  test("a run holds the app between its scenarios, so another session waits for the run's end", async () => {
    const ctx = context()
    await session('run-R1-0')
    await session('run-R1-1')
    await session('lease-d')
    await takeLease(ctx, APP, 'run-R1-0', fast)
    expect(desktopHold(ctx)).toMatchObject({ kind: 'run', run: 'R1' })
    releaseLease(ctx)
    const other = takeLease(ctx, APP, 'lease-d', fast)
    expect(await pending(other)).toBe(true)
    await takeLease(ctx, APP, 'run-R1-1', fast)
    releaseLease(ctx)
    releaseRunHolds('R1')
    await other
    expect(leaseHolder(ctx)).toBe('lease-d')
  })

  test('a run waits out a hold file a killed holder left empty, rather than lease without its hold', async () => {
    const ctx = context()
    await session('run-R3-0')
    mkdirSync(SIM_HOME, { recursive: true })
    writeFileSync(join(SIM_HOME, `desktop-${ctx}.hold`), '')
    const lease = takeLease(ctx, APP, 'run-R3-0', fast)
    expect(await pending(lease)).toBe(true)
    expect(leaseHolder(ctx)).toBeNull()
    await lease
    expect(desktopHold(ctx)).toMatchObject({ kind: 'run', run: 'R3' })
    releaseLease(ctx)
    releaseRunHolds('R3')
  }, 15_000)
})

describe('installing the desktop app', () => {
  test("waits while another checkout's session holds the app, then records where it came from", async () => {
    const ctx = context()
    await session('install-a', 'checkout-elsewhere')
    await takeLease(ctx, APP, 'install-a', fast)
    let ran = false
    const install = withDesktopInstall(
      ctx,
      APP,
      async () => {
        ran = true
      },
      fast,
    )
    expect(await pending(install)).toBe(true)
    expect(ran).toBe(false)
    releaseLease(ctx)
    await install
    expect(ran).toBe(true)
    expect(desktopHold(ctx)).toBeNull()
    expect(installedBuild(ctx)?.commit).toMatch(/^[0-9a-f]{40}$/)
  })

  test("goes ahead under this checkout's own session, and says that session's device quits", async () => {
    const ctx = context()
    await session('install-b')
    await takeLease(ctx, APP, 'install-b', fast)
    const lines: string[] = []
    await withDesktopInstall(ctx, APP, async () => {}, { ...fast, log: (l) => lines.push(l) })
    expect(lines).toEqual([
      `Session install-b in this checkout has a desktop device on ${APP}, which the install quits. Start it again with \`bun sim device start\`.`,
    ])
  })

  test('waits for a run in this checkout, which an install would break halfway', async () => {
    const ctx = context()
    await session('run-R2-0')
    await takeLease(ctx, APP, 'run-R2-0', fast)
    releaseLease(ctx)
    const install = withDesktopInstall(ctx, APP, async () => {}, fast)
    expect(await pending(install)).toBe(true)
    releaseRunHolds('R2')
    await install
  })
})
