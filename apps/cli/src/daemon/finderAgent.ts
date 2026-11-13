/*
 * The mount adapter for macOS. It runs the desktop app's Finder agent to
 * remove Finder's copies of files, to read which files Finder holds, and to
 * have Finder hand a file's bytes back.
 *
 * The agent is an executable the app ships in `Contents/MacOS`, where the
 * system lets it act on the app's File Provider domain, and the app records
 * its path in the library's `mount` setting. That setting can be
 * written by any process that reaches the daemon's socket, so the path is
 * run only once `codesign` shows a valid signature from an Apple-issued
 * certificate with an identifier ending `.finder-agent`. Without the
 * identifier check, any program Apple signs, `/bin/rm` among them, would
 * pass. The check does not pin a team, since a daemon run from source or the
 * CLI has none of its own to compare with. That is enough because the socket
 * is open only to this user, who can run any program anyway, so the check
 * stops a stale or mistaken path rather than an attacker.
 *
 * Errors thrown from here carry fixed text. The command line, which names
 * the agent's path, the domain and the item ids, goes to the daemon's log
 * instead.
 *
 * Each call writes its answer to a file the daemon names rather than to
 * stdout, so a large answer never meets `execFile`'s output buffer limit.
 */
import type {
  DehydrateResult,
  Mount,
  MountAdapter,
  MountChanges,
  ResendResult,
} from '@siastorage/core/adapters'
import { logger } from '@siastorage/logger'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A call evicts at most `MOUNT_DEHYDRATE_BATCH` items, `Evict.concurrency` at a
 * time in the agent, each waiting a fixed time in fileproviderd however large
 * the file is, so a full call ends far inside this. A timeout loses every
 * result in the call.
 */
const EVICT_TIMEOUT_MS = 60_000
const VERIFY_TIMEOUT_MS = 20_000
/**
 * A full read of the materialized set takes time in proportion to the files
 * Finder holds, so this bounds how large a set one read can cover.
 */
const WALK_TIMEOUT_MS = 5 * 60_000
/** The code signing identifier the app's packaging gives the agent, after the app's bundle id. */
const AGENT_IDENTIFIER_SUFFIX = '.finder-agent'

/**
 * The agent's eviction answers the core tells apart. `busy` (a process has
 * the file open), `linked` (more than one hard link), `unsynced` (local edits
 * not handed over yet) and `failed` all mean the file stays for now, which
 * the core calls `busy`.
 */
const RESULTS: Readonly<Record<string, DehydrateResult>> = {
  evicted: 'done',
  refused: 'refused',
}

/** A resend only asks the system to schedule work, so it answers at once. */
const RESEND_TIMEOUT_MS = 60_000

type Run = (
  file: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<{ stdout: string; stderr: string }>

const run: Run = (file, args, timeoutMs, signal) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, signal }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim().slice(0, 200)
        reject(new Error(`${error.message}${detail ? ` (${detail})` : ''}`))
        return
      }
      resolve({ stdout, stderr })
    })
  })

/**
 * Throws unless `path` is a validly signed Finder agent. `codesign -dv`
 * prints the signature's details on stderr.
 */
async function verifyAgent(path: string, exec: Run): Promise<void> {
  await exec(
    '/usr/bin/codesign',
    ['--verify', '--strict', '-R=anchor apple generic', path],
    VERIFY_TIMEOUT_MS,
  )
  const { stderr } = await exec('/usr/bin/codesign', ['-dv', path], VERIFY_TIMEOUT_MS)
  const identifier = /^Identifier=(.+)$/m.exec(stderr)?.[1]
  if (!identifier?.endsWith(AGENT_IDENTIFIER_SUFFIX)) {
    throw new Error(`${path} is not signed as a Finder agent (identifier ${identifier ?? 'none'})`)
  }
}

export function createFinderAgent(opts: { exec?: Run } = {}): MountAdapter {
  const exec = opts.exec ?? run
  /** The last path that passed verification, and the file it was then. */
  let verified: { path: string; stamp: string } | null = null

  async function ensureVerified(path: string): Promise<void> {
    const info = await stat(path)
    // An app update replaces the agent in place, so a changed file is
    // checked again.
    const stamp = `${info.ino}:${info.size}:${info.mtimeMs}`
    if (verified?.path === path && verified.stamp === stamp) return
    verified = null
    await verifyAgent(path, exec)
    verified = { path, stamp }
  }

  /**
   * Runs one agent verb, which writes its answer to a file in a directory
   * made for the call, and reads the answer back with `parse`. Any failure
   * throws `failure`, with the details in the log.
   */
  async function call<T>(
    mount: Mount,
    verb: string,
    args: string[],
    timeoutMs: number,
    signal: AbortSignal | undefined,
    parse: (text: string) => T,
    failure: string,
  ): Promise<T> {
    let dir: string | null = null
    try {
      const agentPath = mount.adapterConfig
      if (!agentPath) throw new Error('the mount setting names no Finder agent')
      dir = await mkdtemp(join(tmpdir(), 'sia-finder-'))
      const out = join(dir, `${verb}.json`)
      await ensureVerified(agentPath)
      await exec(agentPath, [verb, mount.id, out, ...args], timeoutMs, signal)
      return parse(await readFile(out, 'utf8'))
    } catch (e) {
      // A shutdown aborting the call is not a failure.
      if (signal?.aborted) logger.info('finderAgent', `${verb}_aborted`, {})
      else logger.error('finderAgent', `${verb}_failed`, { args: args.length, error: e as Error })
      throw new Error(failure)
    } finally {
      if (dir !== null) {
        await rm(dir, { recursive: true, force: true }).catch((e) =>
          logger.warn('finderAgent', 'cleanup_failed', { error: e as Error }),
        )
      }
    }
  }

  return {
    async dehydrate(mount: Mount, stackIds: string[], signal?: AbortSignal) {
      if (stackIds.length === 0) return {}
      return call(
        mount,
        'evict',
        stackIds,
        EVICT_TIMEOUT_MS,
        signal,
        parseEvictResults,
        'Finder could not remove these downloads now',
      )
    },

    async resend(mount: Mount, stackIds: string[], signal?: AbortSignal) {
      if (stackIds.length === 0) return {}
      return call(
        mount,
        'resend',
        stackIds,
        RESEND_TIMEOUT_MS,
        signal,
        parseResendResults,
        'Finder could not hand these files back now',
      )
    },

    changes: (mount: Mount, cursor: string | null, signal?: AbortSignal) =>
      call(
        mount,
        'materialized',
        cursor === null ? [] : [cursor],
        WALK_TIMEOUT_MS,
        signal,
        parseMaterialized,
        'Finder could not list its downloads now',
      ),
  }
}

/** Reads the agent's materialized-set answer, refusing one that lists no anchor. */
export function parseMaterialized(text: string): MountChanges {
  const parsed = JSON.parse(text) as Record<string, unknown>
  if (typeof parsed.anchor !== 'string') throw new Error('The Finder agent wrote no anchor')
  const ids = (key: string) =>
    Array.isArray(parsed[key])
      ? (parsed[key] as unknown[]).filter((id): id is string => typeof id === 'string')
      : undefined
  return {
    cursor: parsed.anchor,
    full: ids('full'),
    added: ids('added'),
    removed: ids('removed'),
  }
}

/**
 * Reads the agent's `{ results: [{ id, result }] }`, dropping entries it
 * cannot read. Any answer other than `evicted` or `refused` reads as `busy`,
 * and the agent's own name for it goes to the log.
 */
export function parseEvictResults(text: string): Record<string, DehydrateResult> {
  const parsed = JSON.parse(text) as { results?: unknown }
  if (!Array.isArray(parsed.results)) throw new Error('The Finder agent wrote no results')
  const results: Record<string, DehydrateResult> = {}
  const kept: Record<string, number> = {}
  for (const entry of parsed.results as { id?: unknown; result?: unknown }[]) {
    if (typeof entry?.id === 'string' && typeof entry.result === 'string') {
      results[entry.id] = RESULTS[entry.result] ?? 'busy'
      if (!RESULTS[entry.result]) kept[entry.result] = (kept[entry.result] ?? 0) + 1
    }
  }
  if (Object.keys(kept).length > 0) logger.info('finderAgent', 'evict_kept', kept)
  return results
}

/** Reads the agent's `{ results: [{ id, result }] }` for a resend. */
export function parseResendResults(text: string): Record<string, ResendResult> {
  const parsed = JSON.parse(text) as { results?: unknown }
  if (!Array.isArray(parsed.results)) throw new Error('The Finder agent wrote no results')
  const results: Record<string, ResendResult> = {}
  for (const entry of parsed.results as { id?: unknown; result?: unknown }[]) {
    if (typeof entry?.id === 'string' && typeof entry.result === 'string') {
      results[entry.id] =
        entry.result === 'asked' || entry.result === 'not-hydrated' ? entry.result : 'failed'
    }
  }
  return results
}
