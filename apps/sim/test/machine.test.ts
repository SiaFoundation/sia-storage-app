import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describePhoneLeases, phoneLeases } from '../src/capacity'
import { allowDatalessDownloads } from '../src/dataless'
import {
  buildHolders,
  type Holder,
  holderRecord,
  readHold,
  releaseHold,
  takeBuildSlot,
  tryHold,
  waiters,
  waitInLine,
  withBuildSlot,
} from '../src/machine'
import { SIM_HOME, Session } from '../src/session'

const children: Bun.Subprocess[] = []
afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  delete process.env.SIM_NATIVE_BUILDS
})

/** A live process that is not this one, to stand for a holder in another checkout. */
function otherProcess(): number {
  const child = Bun.spawn(['sleep', '60'])
  children.push(child)
  return child.pid
}

const record = (pid: number, what = 'something'): Holder => ({
  pid,
  what,
  checkout: 'elsewhere',
  since: new Date().toISOString(),
})

let n = 0
const holdPath = () => join(SIM_HOME, 'test-holds', `${n++}.hold`)

describe('holds', () => {
  test('a free hold is taken, and a second taker is refused while the first lives', () => {
    const path = holdPath()
    expect(tryHold(path, record(otherProcess()))).toBe(true)
    expect(tryHold(path, holderRecord('second'))).toBe(false)
  })

  test("a hold whose process has exited is free, and the next taker's record replaces it", async () => {
    const path = holdPath()
    const child = Bun.spawn(['true'])
    await child.exited
    writeFileSync(path, JSON.stringify(record(child.pid)))
    expect(readHold(path)).toBeNull()
    expect(tryHold(path, holderRecord('next'))).toBe(true)
    expect(readHold(path)?.pid).toBe(process.pid)
  })

  test('releasing frees only a hold this process took', () => {
    const mine = holdPath()
    tryHold(mine, holderRecord('mine'))
    releaseHold(mine)
    expect(existsSync(mine)).toBe(false)
    const theirs = holdPath()
    tryHold(theirs, record(otherProcess()))
    releaseHold(theirs)
    expect(readHold(theirs)?.what).toBe('something')
  })
})

describe('waitInLine', () => {
  test('prints once per blocker, is listed as a waiter while it waits, and is gone after', async () => {
    const lines: string[] = []
    const blockers = ['held by a', 'held by a', 'held by b']
    let seenWaiting: string[] = []
    const got = await waitInLine({
      waitsFor: 'the thing',
      what: 'use the thing',
      timeoutMs: 10_000,
      intervalMs: 10,
      log: (line) => lines.push(line),
      attempt: () => {
        const next = blockers.shift()
        if (next) return { blockedBy: next }
        seenWaiting = waiters().map((w) => `${w.waitsFor}: ${w.blockedBy}`)
        return { got: 42 }
      },
    })
    expect(got).toBe(42)
    expect(lines).toEqual(['Waiting for the thing: held by a', 'Waiting for the thing: held by b'])
    expect(seenWaiting).toEqual(['the thing: held by b'])
    expect(waiters()).toEqual([])
  })

  test('gives up at its deadline and says what blocked it', async () => {
    await expect(
      waitInLine({
        waitsFor: 'the thing',
        what: 'use it',
        timeoutMs: 50,
        intervalMs: 10,
        log: () => {},
        attempt: () => ({ blockedBy: 'held by someone' }),
      }),
    ).rejects.toThrow('waiting for the thing: held by someone')
  })
})

describe('native build slots', () => {
  test('a second build waits for the first, and runs once it ends', async () => {
    const order: string[] = []
    let finishFirst = () => {}
    const first = withBuildSlot('first build', async () => {
      order.push('first starts')
      await new Promise<void>((resolve) => {
        finishFirst = resolve
      })
      order.push('first ends')
    })
    await Bun.sleep(50)
    const second = withBuildSlot('second build', async () => {
      order.push('second starts')
    })
    await Bun.sleep(300)
    expect(order).toEqual(['first starts'])
    expect(buildHolders().map((h) => h.what)).toEqual(['first build'])
    finishFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first starts', 'first ends', 'second starts'])
    expect(buildHolders()).toEqual([])
  })

  test('SIM_NATIVE_BUILDS lets that many run at once', async () => {
    process.env.SIM_NATIVE_BUILDS = '2'
    const a = await takeBuildSlot('a')
    const b = await takeBuildSlot('b')
    expect(a).not.toBe(b)
    expect(
      buildHolders()
        .map((h) => h.what)
        .sort(),
    ).toEqual(['a', 'b'])
    releaseHold(a)
    releaseHold(b)
  })

  test("a build slot held by another checkout's live build is not taken", () => {
    const slot = join(SIM_HOME, 'builds', 'slot-0.hold')
    mkdirSync(join(SIM_HOME, 'builds'), { recursive: true })
    tryHold(slot, record(otherProcess(), 'android build'))
    expect(tryHold(slot, holderRecord('ios build'))).toBe(false)
    expect(buildHolders().map((h) => `${h.what} ${h.checkout}`)).toEqual([
      'android build elsewhere',
    ])
  })
})

describe('phone leases', () => {
  test("phones in every checkout's pool are listed by the session holding them", () => {
    const session = Session.create('phones-a', { fastTimers: true })
    for (const [dir, target] of [
      ['ios-pool-checkout-a', 'UDID-1'],
      ['ios-pool-checkout-a', 'UDID-2'],
      ['android-pool-checkout-b', 'emulator-5554'],
    ]) {
      mkdirSync(join(SIM_HOME, dir), { recursive: true })
      writeFileSync(join(SIM_HOME, dir, `${target}.lease`), session.name)
    }
    // A lease naming a session that is gone holds nothing.
    writeFileSync(join(SIM_HOME, 'ios-pool-checkout-a', 'UDID-3.lease'), 'gone-session')
    const leases = phoneLeases()
    expect(leases.map((l) => l.target).sort()).toEqual(['UDID-1', 'UDID-2', 'emulator-5554'])
    expect(describePhoneLeases(leases)).toBe(
      `session phones-a (2 ios, 1 android) from checkout ${session.state.owner}`,
    )
  })
})

describe.if(process.platform === 'darwin')('cloud-only downloads', () => {
  test('are on for this process and for a process it starts afterwards', () => {
    allowDatalessDownloads()
    expect(allowDatalessDownloads()).toBe(2)
    const child = Bun.spawnSync([
      process.execPath,
      '-e',
      `import { dlopen, FFIType } from 'bun:ffi'
       const lib = dlopen('/usr/lib/libSystem.B.dylib', {
         getiopolicy_np: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
       })
       console.log(lib.symbols.getiopolicy_np(3, 0))`,
    ])
    expect(child.stdout.toString().trim()).toBe('2')
  })
})
