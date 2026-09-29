/**
 * Keeps booted phones within a share of this machine's memory. A phone holds
 * its memory for as long as it stays booted, and on a laptop a few of them
 * beside an editor and a browser leave macOS killing processes to free
 * memory. Every checkout on the machine shares one budget, since each has its
 * own pool and nothing else stops two checkouts booting phones side by side.
 *
 * Booted phones are counted from the machine rather than from sim's records,
 * so a simulator a person booted counts too, and a record a killed run left
 * behind cannot claim memory that is free.
 */
import { totalmem } from 'node:os'
import { basename, join } from 'node:path'
import * as simctl from './ios/simctl'
import { withFileLock } from './lock'
import { type PhoneKind, SIM_HOME } from './session'

/**
 * What each booted phone is budgeted at, in GB. An emulator's covers the 4 GB
 * of guest memory android/emulators.ts gives its AVD and the emulator process
 * around it.
 */
export const PHONE_MEMORY_GB: Record<PhoneKind, number> = {
  ios: 1.5,
  android: 4.5,
}

const countBooted: Record<PhoneKind, () => Promise<number>> = {
  // simctl comes with Xcode, and a machine without it, such as a Mac set up
  // only for emulators, has no simulators to count.
  ios: async () =>
    process.platform === 'darwin'
      ? (await simctl.listDevices().catch(() => [])).filter((d) => d.state === 'Booted').length
      : 0,
  // Every emulator on the machine, whoever started it. The launcher replaces
  // itself with a qemu-system process, which holds the guest's memory.
  android: async () => {
    const ps = Bun.spawnSync(['ps', '-Ao', 'args='])
    return ps.stdout
      .toString()
      .split('\n')
      .filter((line) => basename(line.trim().split(' ')[0] ?? '').startsWith('qemu-system')).length
  },
}

const LOCK = join(SIM_HOME, 'phone-memory.lock')
const WAIT_MS = 30 * 60_000

/** The SIGINT listeners withPhoneRoom adds, told apart from a caller's own. */
const roomListeners = new WeakSet<NodeJS.SignalsListener>()

/** `SIM_PHONE_MEMORY_GB`, or 40% of installed memory. */
export function phoneMemoryBudgetGb(): number {
  const set = Number(process.env.SIM_PHONE_MEMORY_GB)
  return set > 0 ? set : (totalmem() / 2 ** 30) * 0.4
}

/** macOS's memory pressure level: 1 normal, 2 warning, 4 critical. Other systems report 1. */
function pressureLevel(): number {
  if (process.platform !== 'darwin') return 1
  const out = Bun.spawnSync(['sysctl', '-n', 'kern.memorystatus_vm_pressure_level'])
  return Number(out.stdout.toString().trim()) || 1
}

/**
 * Why one more phone of `kind` cannot boot, or null when it can. The first
 * phone boots whatever the budget, so a machine whose budget is smaller than
 * one phone can still run scenarios one at a time.
 */
export function refusal(
  kind: PhoneKind,
  booted: Record<PhoneKind, number>,
  budgetGb: number,
  pressure: number,
): string | null {
  if (pressure > 1) return 'macOS reports memory pressure'
  const kinds = Object.keys(booted) as PhoneKind[]
  if (kinds.every((k) => booted[k] === 0)) return null
  const used = kinds.reduce((sum, k) => sum + booted[k] * PHONE_MEMORY_GB[k], 0)
  if (used + PHONE_MEMORY_GB[kind] <= budgetGb) return null
  return `booted phones hold about ${used.toFixed(1)} GB of the ${budgetGb.toFixed(1)} GB budget (SIM_PHONE_MEMORY_GB)`
}

/**
 * Calls `attempt` under a lock every checkout takes, with whether one more
 * phone of `kind` fits, until it returns something other than null. An
 * attempt without room can still take a phone that is already booted, which
 * costs nothing, so a phone waiting here takes one another session hands
 * back rather than waiting for memory that phone is holding. An attempt that
 * boots a phone must return only once the phone counts as booted, or the next
 * attempt would see room for it twice.
 */
export async function withPhoneRoom<T>(
  kind: PhoneKind,
  attempt: (room: boolean) => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + WAIT_MS
  let told = false
  // Any SIGINT listener turns off the default exit on Ctrl-C. Under `sim run`
  // the runner listens too and tears its devices down, and this one stops the
  // wait, which can last half an hour, rather than leaving it until the
  // runner's forced teardown a minute later. Where only these listen, as in
  // `up` or `device add` starting one phone or several, the command exits once
  // the lock is released.
  const othersListen = process.listeners('SIGINT').some((l) => !roomListeners.has(l))
  let interrupted = false
  const onInterrupt = () => {
    interrupted = true
  }
  roomListeners.add(onInterrupt)
  process.once('SIGINT', onInterrupt)
  try {
    return await waitForRoom()
  } finally {
    process.off('SIGINT', onInterrupt)
    if (interrupted && !othersListen) process.exit(130)
  }

  async function waitForRoom(): Promise<T> {
    for (;;) {
      const { got, reason } = await withFileLock(
        LOCK,
        async () => {
          const booted = {} as Record<PhoneKind, number>
          for (const k of Object.keys(countBooted) as PhoneKind[])
            booted[k] = await countBooted[k]()
          const reason = refusal(kind, booted, phoneMemoryBudgetGb(), pressureLevel())
          return { got: await attempt(reason === null), reason }
        },
        { timeoutMs: WAIT_MS },
      )
      if (got !== null) return got
      if (Date.now() >= deadline) {
        throw new Error(
          `No room to boot a ${kind} phone after ${WAIT_MS / 60_000} minutes: ${reason}`,
        )
      }
      if (!told) console.error(`Waiting to boot a ${kind} phone: ${reason}`)
      told = true
      for (let waited = 0; waited < 5000 && !interrupted; waited += 250) await Bun.sleep(250)
      if (interrupted) throw new Error(`Stopped waiting to boot a ${kind} phone`)
    }
  }
}
