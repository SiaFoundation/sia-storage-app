/** The pool of iOS simulators for this checkout. */
import { join } from 'node:path'
import { withPhoneRoom } from '../capacity'
import { DevicePool } from '../pool'
import { defaultSessionName, SIM_HOME } from '../session'
import * as simctl from './simctl'

const pool = new DevicePool(join(SIM_HOME, `ios-pool-${defaultSessionName()}`))

/**
 * Leases a simulator, booted ones first, since reusing one skips the boot. One
 * that is not booted starts booting here, and only once it fits the memory
 * budget in capacity.ts.
 */
export function lease(session: string): Promise<string> {
  return withPhoneRoom('ios', async (room) => {
    const devices = await simctl.listDevices()
    const booted = devices.filter((d) => d.state === 'Booted').map((d) => d.udid)
    const cold = devices.filter((d) => d.state !== 'Booted').map((d) => d.udid)
    const udid = await pool.lease(
      session,
      room ? [...booted, ...cold] : booted,
      room
        ? async (adopt) => {
            const created = await simctl.create(
              `${simctl.SIM_PREFIX}${defaultSessionName()}-${crypto.randomUUID().slice(0, 8)}`,
            )
            adopt(created)
            return created
          }
        : null,
    )
    if (udid && !booted.includes(udid)) await simctl.startBoot(udid)
    return udid
  })
}

/** Boots a simulator a session already holds, such as one resumed after `down`, once it fits. */
export async function bootHeld(udid: string): Promise<void> {
  await withPhoneRoom('ios', async (room) => {
    const device = (await simctl.listDevices()).find((d) => d.udid === udid)
    if (device?.state === 'Booted') return true
    if (!room) return null
    await simctl.startBoot(udid)
    return true
  })
  await simctl.boot(udid)
}

export function release(udid: string): void {
  pool.release(udid)
}

/**
 * Shuts down the pooled simulators no session has held for `idleMs` and keeps
 * them in the pool. The next lease boots one rather than creating a new
 * simulator, whose first UI session would build WebDriverAgent again.
 */
export async function shutdownIdle(idleMs: number): Promise<string[]> {
  // Checked before the lock too, since every sim command calls this and a
  // lease holds the lock while it creates a simulator.
  if (pool.idle(idleMs).length === 0) return []
  return pool.locked(async () => {
    const idle = pool.idle(idleMs)
    for (const udid of idle) {
      await simctl.shutdown(udid)
      pool.markOff(udid)
    }
    return idle
  })
}

export function busy(idleMs: number): boolean {
  return pool.busy(idleMs)
}

/**
 * Shuts down and deletes every pooled simulator no session holds, and any
 * simulator this checkout created that a killed run left out of the pool.
 */
export async function drain(): Promise<string[]> {
  // Off macOS there is no simctl, and nothing could have made a simulator.
  if (process.platform !== 'darwin') return []
  return pool.locked(async () => {
    const drained = pool.members().filter((udid) => !pool.isLeased(udid))
    // The whole name, since a checkout's name can be the start of another's.
    const ours = new RegExp(`^${simctl.SIM_PREFIX}${defaultSessionName()}-[0-9a-f]{8}$`)
    const leased = new Set(pool.members().filter((udid) => pool.isLeased(udid)))
    for (const device of await simctl.listDevices()) {
      if (ours.test(device.name) && !leased.has(device.udid) && !drained.includes(device.udid)) {
        drained.push(device.udid)
      }
    }
    for (const udid of drained) {
      await simctl.shutdown(udid)
      await simctl.remove(udid)
      pool.forget(udid)
    }
    return drained
  })
}
