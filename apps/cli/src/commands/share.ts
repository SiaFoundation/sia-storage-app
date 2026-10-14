/**
 * Share links from the command line: make a link to files, add files to one,
 * take them off, revoke it, and list the links with what each one shows.
 *
 * The same links the phone and desktop make. Each lives on the indexer, so a
 * link made here appears on the account's other devices and theirs here.
 */
import type { AppService } from '@siastorage/core/app'
import {
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  type ExpiryChoice,
  expiresAt,
  expiryLabel,
  linkProgress,
  linkTitle,
  modeLabel,
  shareErrorText,
} from '@siastorage/core/lib/shareLinkText'
import type { ShareLink } from '@siastorage/core/types'
import { getPaths } from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c, formatBytes } from '../lib/format'
import { normalizePath } from '../lib/normalizePath'
import { resolveFile } from '../lib/resolveFile'

/** Characters of a link's key shown in `sia links`, enough to name it in the other commands. */
const KEY_SHOWN = 8

/**
 * A link's key without its scheme. Keys read `ed25519:` and then hex, so
 * every key starts the same way and only what follows tells them apart.
 */
function keyBody(publicKey: string): string {
  return publicKey.slice(publicKey.indexOf(':') + 1)
}

/**
 * Starts the daemon if needed and returns its socket path. The caller makes
 * the client: it forwards every property to the daemon, `then` included, so
 * a promise resolving to the client would send the daemon a `then` call.
 */
async function ensureDaemon(dataDir: string): Promise<string> {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  return p.sockPath
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

/**
 * Runs a link change, printing the core's own message when it fails, such as
 * "None of these files can be shared", and `fallback` for anything else. An
 * SDK or network error can quote the indexer's address with its credentials,
 * so it is never printed. The daemon's log has it.
 */
async function change<T>(run: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await run()
  } catch (e) {
    fail(shareErrorText(e, fallback))
  }
}

/**
 * The account's links, listed from the indexer first. `links()` reads the
 * local copy, which the daemon refreshes every few minutes, so a link made or
 * revoked on another device would be missing or still listed. Offline, the
 * local copy is what there is.
 */
async function currentLinks(app: AppService): Promise<ShareLink[]> {
  await app.shares.syncLinks({ refresh: true }).catch(() => {})
  return app.shares.links()
}

/** The ids of `targets`, each a file id or path. Folders and missing names fail the command. */
async function fileIdsFor(app: AppService, targets: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const target of targets) {
    const record = await resolveFile(app, target)
    if (record) {
      ids.push(record.id)
      continue
    }
    const normalized = normalizePath(target)
    if (await app.directories.getByPath(normalized)) {
      fail(`"${normalized}" is a folder. A link shares files, so name the files in it.`)
    }
    fail(`Not found: ${normalized}`)
  }
  return ids
}

/**
 * The link `ref` names among `links`: its address, its key, or the start of
 * its key, with or without the scheme. When no link or several match, the
 * message to print instead.
 */
export function matchLink(links: ShareLink[], ref: string): ShareLink | string {
  const exact = links.find((l) => l.url === ref || l.publicKey === ref)
  if (exact) return exact
  const matches = links.filter((l) => keyBody(l.publicKey).startsWith(keyBody(ref)))
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) return `"${ref}" matches ${matches.length} links. Give more of the key.`
  return `No link "${ref}". Run ${c.bold('sia links')} to see them.`
}

/**
 * Splits `targets` into the ids of files `link` already shares, named by id
 * or path, and the targets it does not. Taking a file off a link reads the
 * link first, since a file in the trash is still on the link but no longer
 * found by name in the library, and restoring it would share it again.
 */
export function filesOnLink(link: ShareLink, targets: string[]): { ids: string[]; rest: string[] } {
  const ids: string[] = []
  const rest: string[] = []
  for (const target of targets) {
    const path = normalizePath(target)
    const file = link.files.find(
      (f) => f.fileId === target || (f.folder ? `${f.folder}/${f.name}` : f.name) === path,
    )
    if (file) ids.push(file.fileId)
    else rest.push(target)
  }
  return { ids, rest }
}

async function findLink(app: AppService, ref: string): Promise<ShareLink> {
  const found = matchLink(await currentLinks(app), ref)
  if (typeof found === 'string') fail(found)
  return found
}

/**
 * How many files `link` shares after a change, read back rather than counted
 * from the request: the core skips a file the link already has and a second
 * version of one it has.
 */
async function fileCount(app: AppService, link: ShareLink): Promise<string> {
  const after = (await app.shares.links()).find((l) => l.publicKey === link.publicKey)
  const n = after?.files.length ?? 0
  return `${n} file${n === 1 ? '' : 's'}`
}

function parseExpiry(value: string | undefined): ExpiryChoice {
  if (value === undefined) return DEFAULT_EXPIRY
  const choice = EXPIRY_CHOICES.find((e) => e.id === value)
  if (!choice) fail(`--expires takes ${EXPIRY_CHOICES.map((e) => e.id).join(', ')}`)
  return choice.id
}

export async function shareCommand(
  dataDir: string,
  targets: string[],
  opts: { expires?: string; snapshot?: boolean; to?: string },
) {
  const app = createDaemonClient(await ensureDaemon(dataDir))
  const fileIds = await fileIdsFor(app, targets)

  if (opts.to) {
    if (opts.expires !== undefined || opts.snapshot) {
      fail('--expires and --snapshot are fixed when a link is made, so they cannot go with --to')
    }
    const link = await findLink(app, opts.to)
    await change(
      () => app.shares.addLinkFiles(link.publicKey, fileIds),
      'Could not add the files to the link.',
    )
    console.log(`${link.url} now shares ${await fileCount(app, link)}`)
    return
  }

  const expiry = parseExpiry(opts.expires)
  const link = await change(
    () =>
      app.shares.createLink(fileIds, {
        expiresAt: expiresAt(expiry, Date.now()),
        mode: opts.snapshot ? 'snapshot' : 'latest',
      }),
    'Could not make the link.',
  )
  console.log(link.url)
  console.error(
    c.dim(
      `${linkTitle(link)}. ${modeLabel(link.mode)}. ${expiryLabel(link.expiresAt, Date.now())}.`,
    ),
  )
}

export async function unshareCommand(dataDir: string, ref: string, targets: string[]) {
  const app = createDaemonClient(await ensureDaemon(dataDir))
  const link = await findLink(app, ref)
  const { ids, rest } = filesOnLink(link, targets)
  const fileIds = [...ids, ...(await fileIdsFor(app, rest))]
  await change(
    () => app.shares.removeLinkFiles(link.publicKey, fileIds),
    'Could not take the files off the link.',
  )
  console.log(`${link.url} now shares ${await fileCount(app, link)}`)
}

export async function revokeCommand(dataDir: string, ref: string) {
  const app = createDaemonClient(await ensureDaemon(dataDir))
  const link = await findLink(app, ref)
  await change(() => app.shares.revokeLink(link.publicKey), 'Could not revoke the link.')
  console.log(`Revoked ${link.url}. Anyone holding it can no longer open it.`)
}

export async function linksCommand(dataDir: string, opts: { json?: boolean }) {
  const app = createDaemonClient(await ensureDaemon(dataDir))
  const links = await currentLinks(app)
  if (opts.json) {
    console.log(JSON.stringify(links, null, 2))
    return
  }
  if (links.length === 0) {
    console.log(c.dim('No share links'))
    return
  }
  const now = Date.now()
  for (const link of links) {
    const waiting = linkProgress(link)
    console.log(
      `${c.bold(keyBody(link.publicKey).slice(0, KEY_SHOWN))}  ${linkTitle(link)}  ${c.dim(
        `${modeLabel(link.mode)}, ${expiryLabel(link.expiresAt, now).toLowerCase()}`,
      )}`,
    )
    console.log(`  ${c.cyan(link.url)}`)
    if (waiting) console.log(`  ${c.yellow(waiting)}`)
    for (const file of link.files) {
      const path = file.folder ? `${file.folder}/${file.name}` : file.name
      const state = file.state === 'shared' ? '' : c.dim(` (${file.state})`)
      console.log(`  ${path}  ${c.dim(formatBytes(file.size))}${state}`)
    }
  }
}
