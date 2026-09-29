/** Steps the photo library scenarios share. */
import type { NetworkControl } from '@siastorage/mock-network/control'
import type { PhoneDevice } from '../../src/devices'
import { fileHash } from '../../src/integrity'
import type { DeviceMap, ScenarioContext } from '../../src/scenario'

/**
 * The content hashes of the phone's files. The photo library renames what it
 * stores, IMG_0001.PNG and so on, but keeps the bytes, so a photo is found by
 * its content.
 */
export async function fileHashes(phone: PhoneDevice): Promise<Set<string>> {
  return new Set((await phone.library()).map((f) => fileHash(f.hash)))
}

/** Objects on the network that are files rather than their thumbnails. */
export async function fileObjects(network: NetworkControl): Promise<number> {
  return (await network.objects()).filter((o) => o.metadata?.kind === 'file').length
}

/** Import rows the given photo import source has created, by state. */
export async function photoImportStates(
  phone: PhoneDevice,
  source: 'new-photos' | 'library-scan',
): Promise<Record<string, number>> {
  const rows = await phone.sql<{ state: string; n: number }>(
    `SELECT f.state, count(*) AS n FROM import_files f JOIN imports i ON i.id = f.importId
     WHERE i.source = ?1 GROUP BY f.state`,
    source,
  )
  return Object.fromEntries(rows.map((r) => [r.state, r.n]))
}

/** Grants the app full photo library access and checks the app now has it. */
export function photoAccess(
  phone: PhoneDevice,
  ctx: Pick<ScenarioContext<DeviceMap>, 'precondition'>,
): Promise<boolean> {
  return ctx.precondition('the app can read the photo library', async () => {
    await phone.grantPhotoAccess()
    return phone.call<boolean>('sim.photoAccess')
  })
}
