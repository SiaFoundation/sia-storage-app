/** Steps scenarios in every folder share. */
import type { DeviceMap, ScenarioContext } from '../src/scenario'

/**
 * Waits until `device` has an upload under way on the network and fewer than
 * `total` objects are pinned, so an action taken next lands mid-upload. An
 * accepted start is logged as `upload` and each commit as `commit`, so one
 * more accepted start than commits means an upload is running.
 */
export function uploadInFlight(
  ctx: Pick<ScenarioContext<DeviceMap>, 'precondition' | 'network' | 'waitFor'>,
  device: string,
  total: number,
): Promise<boolean> {
  return ctx.precondition(`an upload from ${device} is in flight`, async () => {
    await ctx.waitFor(`${device} to have an upload under way`, async () => {
      const started = await ctx.network.requests({ device, op: 'upload' })
      const committed = await ctx.network.requests({ device, op: 'commit' })
      return started.filter((r) => r.status === 200).length > committed.length
    })
    return (await ctx.network.objects()).length < total
  })
}
