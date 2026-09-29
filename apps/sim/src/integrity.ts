/**
 * Checks that every uploaded file points at a pinned object holding its own
 * bytes. A file whose object holds another file's bytes, or whose object was
 * never pinned, looks fine in every library view and only shows up when
 * someone opens it, so no sync check catches it.
 */
import { createHash } from 'node:crypto'
import type { NetworkControl } from '@siastorage/mock-network/control'
import type { Device } from './devices'

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A file row's hash, stored as `sha256:<hex>`, as the bare hex the network reports. */
export function fileHash(hash: string): string {
  return hash.replace(/^sha256:/, '')
}

type Row = { fileId: string; name: string; hash: string; objectId: string }

/**
 * How many of the device's files point at an object, and one line per file
 * whose object is missing, unpinned, or holds bytes that do not match the
 * file's hash. The app writes an objects row only once its pin has succeeded,
 * so an unpinned object behind a file is a failure, not a pin in progress.
 */
export async function contentMismatches(
  device: Device,
  network: NetworkControl,
): Promise<{ checked: number; problems: string[] }> {
  const rows = await device.sql<Row>(
    `SELECT f.id AS fileId, f.name, f.hash, o.id AS objectId
     FROM files f JOIN objects o ON o.fileId = f.id
     WHERE f.kind = 'file' AND f.deletedAt IS NULL`,
  )
  const objects = new Map((await network.objects({ unpinned: true })).map((o) => [o.id, o]))
  const out: string[] = []
  for (const row of rows) {
    const onNetwork = objects.get(row.objectId)
    const expected = fileHash(row.hash)
    if (onNetwork === undefined) {
      out.push(
        `${device.name}: ${row.name} (${row.fileId}) points at ${row.objectId}, which the network does not have`,
      )
    } else if (!onNetwork.pinned) {
      out.push(
        `${device.name}: ${row.name} (${row.fileId}) points at ${row.objectId}, which was never pinned`,
      )
    } else if (onNetwork.contentHash !== expected) {
      out.push(
        `${device.name}: ${row.name} (${row.fileId}) points at ${row.objectId}, which holds other bytes`,
      )
    }
  }
  return { checked: rows.length, problems: out }
}
