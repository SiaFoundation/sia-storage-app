/**
 * The trash from the command line: list what is in it, put entries back,
 * delete them for good, or empty it.
 *
 * An entry is a file with the versions trashed along with it, the same
 * entries the phone and desktop app show.
 */
import type { TrashEntry } from '@siastorage/core/types'
import { createDaemonClient } from '../lib/appServiceClient'
import { ensureDaemon, fail } from '../lib/daemonCommand'
import { c, formatBytes, formatRelativeDate, table } from '../lib/format'
import { normalizePath } from '../lib/normalizePath'

/** The fewest characters of an entry's id `sia trash` shows. */
const ID_SHOWN = 8

function pathOf(entry: TrashEntry): string {
  return entry.folder ? `${entry.folder}/${entry.name}` : entry.name
}

/**
 * The entry `ref` names among `entries`: its id, the start of its id, or its
 * path. When none or several match, the message to print instead.
 */
export function matchTrashEntry(entries: TrashEntry[], ref: string): TrashEntry | string {
  const byId = entries.find((e) => e.id === ref)
  if (byId) return byId
  const path = normalizePath(ref)
  const matches = entries.filter((e) => pathOf(e) === path || e.id.startsWith(ref))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    return `"${ref}" matches ${matches.length} entries. Give the id ${c.bold('sia trash')} shows.`
  }
  return `Nothing in the trash matches "${ref}".`
}

/**
 * The start of each id long enough to name it alone, and never shorter than
 * ID_SHOWN. Sorted, an id shares the most with its neighbours, so one
 * character past the longer of those two shared starts tells it apart.
 */
export function shownIds(ids: string[]): Map<string, string> {
  const sorted = [...ids].sort()
  const shared = (a: string | undefined, b: string) => {
    if (a === undefined) return 0
    let n = 0
    while (n < a.length && n < b.length && a[n] === b[n]) n++
    return n
  }
  const shown = new Map<string, string>()
  sorted.forEach((id, i) => {
    const length = Math.max(shared(sorted[i - 1], id), shared(sorted[i + 1], id)) + 1
    shown.set(id, id.slice(0, Math.max(ID_SHOWN, length)))
  })
  return shown
}

/**
 * Every entry in the trash, read in one query. Pages read one after another
 * shift when an entry is restored between them, which would hide an entry
 * and let a short id or path look like it names only one. The limit starts
 * above the count and doubles in the rare case the trash grew past it.
 */
async function allEntries(app: ReturnType<typeof createDaemonClient>): Promise<TrashEntry[]> {
  let limit = (await app.files.trashCount()) + 100
  for (;;) {
    const entries = await app.files.trashEntries({ limit })
    if (entries.length < limit) return entries
    limit *= 2
  }
}

async function entriesFor(app: ReturnType<typeof createDaemonClient>, refs: string[]) {
  const entries = await allEntries(app)
  return refs.map((ref) => {
    const found = matchTrashEntry(entries, ref)
    if (typeof found === 'string') fail(found)
    return found
  })
}

function versionsNote(entry: TrashEntry): string {
  return entry.versions === 1 ? '' : c.dim(` (${entry.versions} versions)`)
}

/**
 * Why `sia trash` refuses these arguments, or null when it takes them.
 * `--empty` with a name is refused rather than run: it deletes everything,
 * and a name beside it reads as asking for that one file.
 */
export function optionsError(
  refs: string[],
  opts: { empty?: boolean; delete?: boolean },
): string | null {
  if (opts.empty && (refs.length > 0 || opts.delete)) {
    return `${c.bold('--empty')} deletes everything in the trash, so it takes no names or --delete`
  }
  if (opts.delete && refs.length === 0) return `Name what to delete, or use ${c.bold('--empty')}`
  return null
}

export async function trashCommand(
  dataDir: string,
  refs: string[],
  opts: { empty?: boolean; delete?: boolean },
) {
  const app = createDaemonClient(await ensureDaemon(dataDir))

  const refused = optionsError(refs, opts)
  if (refused) fail(refused)

  if (opts.empty) {
    const removed = await app.files.emptyTrash()
    console.log(removed === 0 ? c.dim('The trash is empty') : `Deleted ${removed} for good`)
    return
  }

  if (opts.delete) {
    const entries = await entriesFor(app, refs)
    const deleted = new Set(await app.files.deleteTrashEntries(entries.map((e) => e.id)))
    for (const entry of entries) {
      console.log(
        deleted.has(entry.id)
          ? `Deleted ${c.red(pathOf(entry))} for good`
          : c.dim(`${pathOf(entry)} is no longer in the trash, so nothing was deleted`),
      )
    }
    return
  }

  const entries = await allEntries(app)
  if (entries.length === 0) {
    console.log(c.dim('The trash is empty'))
    return
  }
  const now = Date.now()
  const ids = shownIds(entries.map((e) => e.id))
  console.log(
    table(
      ['ID', 'NAME', 'SIZE', 'TRASHED', 'DELETED IN'],
      entries.map((e) => [
        ids.get(e.id) ?? e.id,
        pathOf(e) + versionsNote(e),
        formatBytes(e.size),
        formatRelativeDate(e.trashedAt),
        `${Math.max(0, Math.ceil((e.purgeAt - now) / (24 * 60 * 60 * 1000)))} days`,
      ]),
    ),
  )
}

export async function restoreCommand(dataDir: string, refs: string[]) {
  const app = createDaemonClient(await ensureDaemon(dataDir))
  const entries = await entriesFor(app, refs)
  const restored = await app.files.restoreTrashEntries(entries.map((e) => e.id))
  for (const entry of entries) {
    const back = restored.find((r) => r.id === entry.id)
    // Missing when the entry left the trash between listing it and now.
    if (!back) continue
    const renamed = back.renamedFrom ? ` as ${c.green(back.name)}, since the name is taken` : ''
    console.log(`Restored ${c.green(pathOf(entry))}${versionsNote(entry)}${renamed}`)
  }
}
