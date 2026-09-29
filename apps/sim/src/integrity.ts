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

/**
 * Whether every content problem is a file pointing at another file's object,
 * as opposed to a missing or unpinned one.
 */
export function onlyOtherFilesBytes(problems: string[]): boolean {
  return problems.length > 0 && problems.every((p) => p.endsWith(', which holds other bytes'))
}

/**
 * The hashes of file bytes pinned under more than one object. An upload that
 * runs twice for one file pins its bytes twice, which a count of pinned
 * objects cannot tell apart from an object pinned for no file.
 */
export async function pinnedTwice(network: NetworkControl): Promise<string[]> {
  const pins = new Map<string, number>()
  for (const o of await network.objects()) {
    if (o.contentHash && o.metadata?.kind === 'file') {
      pins.set(o.contentHash, (pins.get(o.contentHash) ?? 0) + 1)
    }
  }
  return [...pins]
    .filter(([, n]) => n > 1)
    .map(([hash]) => hash)
    .sort()
}
