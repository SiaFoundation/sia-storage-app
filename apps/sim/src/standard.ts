/**
 * Checks every scenario ends with. A scenario's own checks look for the one
 * behavior it is about, and these look for damage any behavior can do along
 * the way: a file pointing at another file's bytes, bytes pinned twice or for
 * no file, devices that never agree, downloads and imports left hanging, a
 * local record with no bytes behind it, and an app that died. They run after
 * the scenario's own steps, and only when those ended without an error.
 *
 * A check whose label the scenario already recorded is not recorded again. A
 * scenario that breaks one of these on purpose names it in
 * `skipStandardChecks` with the reason, and a known bug that breaks one lists
 * its label in `bugShowsAs` like any other check.
 */
import { isDeepStrictEqual } from 'node:util'
import type { NetworkControl } from '@siastorage/mock-network/control'
import { waitForConvergence } from './converge'
import type { Device } from './devices'
import { contentMismatches, pinnedTwice } from './integrity'
import type { CheckRecord } from './scenario'
import { waitFor } from './wait'

export type StandardCheck =
  | 'stillRunning'
  | 'downloadsSettle'
  | 'importsSettle'
  | 'agree'
  | 'ownBytes'
  | 'pinnedOnce'
  | 'noStrayObjects'
  | 'localBytes'

export async function recordStandardChecks(opts: {
  devices: Record<string, Device>
  network: NetworkControl
  checks: CheckRecord[]
  skip?: Partial<Record<StandardCheck, string>>
  signal?: AbortSignal
  /** How long a download or import gets to finish before it counts as left behind. */
  settleMs?: number
}): Promise<void> {
  const { network, checks, skip = {}, settleMs = 30_000 } = opts
  const devices = Object.entries(opts.devices)
  const recorded = new Set(checks.map((c) => c.label))
  const checkEqual = (label: string, actual: unknown, expected: unknown) => {
    if (recorded.has(label)) return isDeepStrictEqual(actual, expected)
    recorded.add(label)
    const ok = isDeepStrictEqual(actual, expected)
    checks.push(
      ok
        ? { label, ok }
        : {
            label,
            ok,
            detail: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
            actual,
          },
    )
    return ok
  }
  // The checks after this one read the device, so one that died is the only result worth recording.
  if (!skip.stillRunning) {
    let allRunning = true
    for (const [name, device] of devices) {
      const running = await device.isRunning().catch(() => false)
      allRunning = checkEqual(`${name} is still running at the end`, running, true) && allRunning
    }
    if (!allRunning) return
  }

  if (!skip.downloadsSettle) {
    for (const [name, device] of devices) {
      checkEqual(
        `${name} has no download left queued or downloading`,
        await settled(() => unsettledDownloads(device), settleMs, opts.signal),
        [],
      )
    }
  }
  if (!skip.importsSettle) {
    for (const [name, device] of devices) {
      checkEqual(
        `${name} has no import left in progress`,
        await settled(() => unsettledImports(device), settleMs, opts.signal),
        {},
      )
    }
  }

  let agree = devices.length < 2
  if (!skip.agree && devices.length >= 2) {
    const problems = await waitForConvergence(
      devices.map(([, d]) => d),
      { timeoutMs: 60_000, signal: opts.signal },
    ).then(
      () => [] as string[],
      (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 10),
    )
    agree = checkEqual('every device holds the same library at the end', problems, [])
  }

  if (!skip.ownBytes) {
    for (const [name, device] of devices) {
      const { checked, problems } = await contentMismatches(device, network)
      if (checked > 0) {
        checkEqual(`every file on ${name} points at an object holding its own bytes`, problems, [])
      }
    }
  }
  if (!skip.pinnedOnce) {
    checkEqual('no file’s bytes are pinned twice', await pinnedTwice(network), [])
  }
  // Before the devices agree, one can still be missing a peer's newest rows,
  // so an object it has not heard of yet would look like a stray. Skipping
  // `agree`, or failing it, skips this check too.
  if (!skip.noStrayObjects && agree) {
    const known = new Set<string>()
    for (const [, device] of devices) {
      for (const row of await device.sql<{ id: string }>('SELECT id FROM objects'))
        known.add(row.id)
    }
    const stray = (await network.objects())
      .filter((o) => o.metadata?.kind === 'file' && !known.has(o.id))
      .map((o) => o.id)
    checkEqual('every pinned object belongs to a file on a device', stray, [])
  }
  if (!skip.localBytes) {
    for (const [name, device] of devices) {
      checkEqual(
        `${name} has the bytes of every file it records as local`,
        await localWithoutBytes(device),
        [],
      )
    }
  }
}

/** Waits up to `timeoutMs` for `probe` to come back empty, then returns what it last found. */
async function settled<T extends unknown[] | Record<string, number>>(
  probe: () => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  let last = await probe()
  const empty = (v: T) => (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0)
  if (empty(last)) return last
  await waitFor(
    'work to settle',
    async () => {
      last = await probe()
      return empty(last) || undefined
    },
    { timeoutMs, intervalMs: 1000, signal },
  ).catch(() => {})
  return last
}

async function unsettledDownloads(device: Device): Promise<string[]> {
  const { downloads } = await device.call<{
    downloads: Record<string, { status: string }>
  }>('downloads.getState')
  return Object.entries(downloads)
    .filter(([, d]) => d.status === 'queued' || d.status === 'downloading')
    .map(([id]) => id)
    .sort()
}

/** Import rows still pending or claimed, by state. */
async function unsettledImports(device: Device): Promise<Record<string, number>> {
  const rows = await device.sql<{ state: string; n: number }>(
    "SELECT state, count(*) AS n FROM import_files WHERE state IN ('pending', 'active') GROUP BY state",
  )
  return Object.fromEntries(rows.map((r) => [r.state, r.n]))
}

/** Files the device records a local copy of with no bytes in its files directory. */
async function localWithoutBytes(device: Device): Promise<string[]> {
  const local = await device.sql<{ fileId: string }>('SELECT fileId FROM fs')
  if (local.length === 0) return []
  const names = (await device.call<string[]>('fs.listFiles')).map((p) => p.split('/').pop() ?? '')
  return local
    .map((r) => r.fileId)
    .filter((id) => !names.some((n) => n.startsWith(id)))
    .sort()
}
