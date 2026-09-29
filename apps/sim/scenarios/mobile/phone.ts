/**
 * Steps phone scenarios share: suspending the phone and checking what it holds
 * while suspended, and reading the suspension errors it logged.
 */
import { IosDevice, type PhoneDevice } from '../../src/devices'
import { suspendHazards } from '../../src/ios/locks'
import type { DeviceMap, ScenarioContext } from '../../src/scenario'

/**
 * Sends the phone to the background and lets the OS act on it. On iOS that
 * waits until iOS has suspended it and records whether it holds any lock that
 * gets a suspended phone killed. Android freezes a backgrounded app on its own
 * schedule and has no such kill, so there it waits ten seconds and notes that
 * the locks went unchecked.
 */
export async function suspendAndCheckLocks(
  phone: PhoneDevice,
  ctx: Pick<ScenarioContext<DeviceMap>, 'step' | 'check' | 'note' | 'precondition'>,
  label = 'the suspended phone',
  /**
   * Checked right after the phone goes to the background: the work the
   * scenario suspends is still running.
   */
  stillRunning?: { name: string; holds: () => Promise<boolean> },
): Promise<void> {
  const since = new Date()
  await ctx.step('send the phone to the background', () => phone.background())
  if (stillRunning) await ctx.precondition(stillRunning.name, stillRunning.holds)
  if (!(phone instanceof IosDevice)) {
    await ctx.step('leave it in the background', () => Bun.sleep(10_000))
    ctx.note(`${label}: locks not checked, since Android does not kill an app for them`)
    return
  }
  await ctx.step('wait for iOS to suspend it', () => phone.waitUntilSuspended(since))
  const hazards = suspendHazards(await phone.locks())
  ctx.check(
    `${label} holds no write lock or WAL read slot`,
    hazards.length === 0,
    JSON.stringify(hazards),
  )
}

/**
 * Errors the phone logged about suspending or its database, as `scope:message`,
 * and a drain that ran past its deadline, which the suspension code only warns about.
 */
export async function suspensionErrors(phone: PhoneDevice): Promise<string[]> {
  const rows = await phone.sql<{ scope: string; message: string }>(
    `SELECT scope, message FROM logs
     WHERE (level = 'error' AND scope IN ('suspension', 'db'))
        OR (scope = 'suspension' AND message = 'drain_deadline')`,
  )
  return rows.map((r) => `${r.scope}:${r.message}`)
}
