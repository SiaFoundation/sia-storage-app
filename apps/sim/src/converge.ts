/**
 * Library comparison across devices. Two devices agree when they show the same
 * files with the same names, content, folders, tags, version status and trash
 * state.
 */
import type { Device, LibraryEntry } from './devices'
import { WaitTimeout, waitFor } from './wait'

const FIELDS = ['name', 'hash', 'size', 'dir', 'current', 'trashed', 'tags'] as const

/** Every way `b` differs from `a`, one line each. Empty when they agree. */
export function diffLibraries(
  a: { name: string; files: LibraryEntry[] },
  b: { name: string; files: LibraryEntry[] },
): string[] {
  const out: string[] = []
  const byId = new Map(b.files.map((f) => [f.id, f]))
  for (const fa of a.files) {
    const fb = byId.get(fa.id)
    if (!fb) {
      out.push(`${fa.id} (${fa.name}) is on ${a.name} but not ${b.name}`)
      continue
    }
    byId.delete(fa.id)
    for (const field of FIELDS) {
      // The core picks a current version among live rows only, so a trashed
      // row keeps whatever flag it had when it was trashed, and two devices
      // that trashed it at different moments can differ there harmlessly.
      if (field === 'current' && fa.trashed && fb.trashed) continue
      const [va, vb] = [String(fa[field]), String(fb[field])]
      if (va !== vb) out.push(`${fa.id} ${field}: ${a.name}=${va} ${b.name}=${vb}`)
    }
  }
  for (const fb of byId.values())
    out.push(`${fb.id} (${fb.name}) is on ${b.name} but not ${a.name}`)
  return out
}

type ConvergeResult = { files: number; waitedMs: number }

/**
 * Waits until every device has uploaded all its files and all libraries agree.
 * On timeout the error lists what still differs.
 */
export async function waitForConvergence(
  devices: Device[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ConvergeResult> {
  if (devices.length === 0) throw new Error('There are no devices to converge')
  const started = Date.now()
  let lastProblems: string[] = []
  try {
    const files = await waitFor(
      'devices to converge',
      async () => {
        const libraries = await Promise.all(
          devices.map(async (d) => ({ name: d.name, files: await d.library() })),
        )
        const problems: string[] = []
        for (const lib of libraries) {
          const pending = lib.files.filter((f) => !f.uploaded)
          if (pending.length > 0)
            problems.push(`${lib.name} has ${pending.length} files not uploaded`)
        }
        for (const other of libraries.slice(1)) problems.push(...diffLibraries(libraries[0], other))
        lastProblems = problems
        return problems.length === 0 ? libraries[0].files.length : undefined
      },
      { timeoutMs: opts.timeoutMs ?? 60_000, intervalMs: 500, signal: opts.signal },
    )
    return { files, waitedMs: Date.now() - started }
  } catch (e) {
    if (!(e instanceof WaitTimeout)) throw e
    const shown = lastProblems.slice(0, 20).join('\n  ')
    const more = lastProblems.length > 20 ? `\n  ...and ${lastProblems.length - 20} more` : ''
    throw new WaitTimeout(`${e instanceof Error ? e.message : String(e)}\n  ${shown}${more}`)
  }
}
