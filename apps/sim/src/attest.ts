/**
 * What `sim attest` posts: the suite each platform runs, the counts read back
 * from the summary line `sim run` prints last, and the commit status built
 * from them. Main's branch rule requires the sim/ios, sim/android and
 * sim/desktop statuses, and pr.yml leaves them pending on the release PR
 * until a run posts a result for its head commit.
 */
import type { Progress } from './report'

export const ATTEST_PLATFORMS = ['ios', 'android', 'desktop'] as const
export type AttestPlatform = (typeof ATTEST_PLATFORMS)[number]

/** The filters and options passed to `sim run`, matching what sim-mobile.yml runs in CI. */
export const ATTEST_SUITES: Record<AttestPlatform, { filters: string[]; options: string[] }> = {
  ios: { filters: ['mobile/', 'photos/'], options: [] },
  android: { filters: ['mobile/', 'photos/'], options: ['--phone', 'android'] },
  desktop: { filters: ['desktop/'], options: [] },
}

export type RunSummary = {
  runId: string
  passed: number
  failed: number
  knownBug: number
  skipped: number
  needReview: number
  /** Crashes while starting devices that a relaunch got past. */
  startCrashes: number
  /** The line after `run <id>: `, as printed. */
  counts: string
}

const SUMMARY =
  /^run (\S+): ((\d+) passed, (\d+) failed(?:, (\d+) known bug)?(?:, (\d+) skipped)?(?:, (\d+) need review)?(?:, (\d+) start crashes)?(?:, (\d+) intermittent)?)$/

/** The last summary line in a `sim run` output, or null when the run ended before printing one. */
export function parseRunSummary(output: string): RunSummary | null {
  const lines = output.split('\n').map((l) => l.trimEnd())
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = SUMMARY.exec(lines[i])
    if (!m) continue
    return {
      runId: m[1],
      counts: m[2],
      passed: Number(m[3]),
      failed: Number(m[4]),
      knownBug: Number(m[5] ?? 0),
      skipped: Number(m[6] ?? 0),
      needReview: Number(m[7] ?? 0),
      startCrashes: Number(m[8] ?? 0),
    }
  }
  return null
}

/** GitHub rejects a status description longer than 140 characters. */
const MAX_DESCRIPTION = 140

const PROGRESS_COUNTS = [
  ['failed', 'failed'],
  ['errored', 'errored'],
  ['knownBug', 'known bug'],
  ['fixed', 'fixed'],
  ['skipped', 'skipped'],
] as const

/**
 * A running suite's progress as a pending status's description: the counts,
 * then the latest result. A failure's reason goes before its scenario name,
 * which the 140-character limit cuts first.
 */
export function progressDescription(p: Progress): string {
  const counts = PROGRESS_COUNTS.filter(([k]) => p[k] > 0)
    .map(([k, word]) => `, ${p[k]} ${word}`)
    .join('')
  const last = !p.latest
    ? ''
    : p.latest.reason
      ? ` Last ${p.latest.verdict}: ${p.latest.reason} (${p.latest.name})`
      : ` Last ${p.latest.verdict}: ${p.latest.name}`
  return `${p.done}/${p.total} done, ${p.passed} passed${counts}.${last}`.slice(0, MAX_DESCRIPTION)
}

/**
 * The status to post for a finished run, or why none is posted. `sim run`
 * exits 130 when interrupted, which proves nothing either way. A skipped
 * scenario is one this machine could not run, so a run with any skipped does
 * not show the platform works.
 */
export function attestStatus(
  exitCode: number,
  summary: RunSummary | null,
): { state: 'success' | 'failure'; description: string } | { refused: string } {
  if (exitCode === 130) return { refused: 'The run was interrupted.' }
  if (summary && summary.skipped > 0) {
    return {
      refused: `${summary.skipped} scenarios were skipped on this machine, so the run does not cover the platform.`,
    }
  }
  const description = summary
    ? `Local: ${summary.counts} (run ${summary.runId})`
    : `Local: the run exited ${exitCode} before printing its summary`
  return {
    state: exitCode === 0 && summary ? 'success' : 'failure',
    description: description.slice(0, MAX_DESCRIPTION),
  }
}

/**
 * Why the working tree cannot vouch for the PR's head commit, or null when it
 * can. A status goes on a commit sha, so posting one for a tree with edits or
 * a different commit would mark a commit green that the run never tested.
 */
export function attestRefusal(state: {
  uncommitted: string
  localHead: string
  pr: { number: number; headRefOid: string } | null
}): string | null {
  if (state.uncommitted.trim() !== '') {
    return 'The working tree has uncommitted changes to tracked files. Commit or discard them, push, and run attest again.'
  }
  if (!state.pr) {
    return 'This branch has no pull request. Open one for it, then run attest again.'
  }
  if (state.localHead !== state.pr.headRefOid) {
    return `Local HEAD ${state.localHead.slice(0, 9)} is not the head of PR #${state.pr.number}, ${state.pr.headRefOid.slice(0, 9)}. Push this commit or check out the PR's head, then run attest again.`
  }
  return null
}

/** `owner/repo` from a pull request URL such as https://github.com/owner/repo/pull/12. */
export function repoFromPrUrl(url: string): string {
  const m = /^https:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/\d+/.exec(url)
  if (!m) throw new Error(`Cannot read the repository from ${url}`)
  return m[1]
}
