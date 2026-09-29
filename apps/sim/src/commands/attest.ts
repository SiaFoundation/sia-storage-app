/**
 * `attest`: runs a platform's suite on this checkout and posts the result as a
 * status on the PR's head commit. `ci-progress`: posts a CI run's progress on
 * that status while the suite runs.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Argument } from 'commander'
import {
  ATTEST_PLATFORMS,
  ATTEST_SUITES,
  type AttestPlatform,
  attestRefusal,
  attestStatus,
  parseRunSummary,
  progressDescription,
  repoFromPrUrl,
} from '../attest'
import type { Progress } from '../report'
import { desktopIdentity, desktopUnavailable } from '../devices/desktop'
import { findScenarios } from '../run'
import { REPO_ROOT } from '../session'
import type { CommandContext } from './shared'

const desktopSetup = (context: string) =>
  `To set it up, copy apps/desktop/env/${context}.example.env to ${context}.env, fill in its five blanks from your Apple Developer account, and run \`bun run desktop:package ${context}\`.`

async function capture(cmd: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(cmd, { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, out, err }
}

type PullRequest = { number: number; headRefOid: string; url: string }

async function currentPullRequest(): Promise<PullRequest | null> {
  const { code, out, err } = await capture(['gh', 'pr', 'view', '--json', 'number,headRefOid,url'])
  if (code === 0) return JSON.parse(out) as PullRequest
  if (/no pull requests found/i.test(err)) return null
  throw new Error(`gh pr view failed: ${err.trim()}`)
}

/**
 * Runs `sim run` as a child so its per-scenario lines appear as they finish,
 * and keeps its stdout to read the summary line from.
 */
async function runSuite(args: string[]): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn(
    [process.execPath, join(import.meta.dir, '..', 'cli.ts'), 'run', ...args],
    {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'inherit',
    },
  )
  const decoder = new TextDecoder()
  let output = ''
  for await (const chunk of proc.stdout) {
    process.stdout.write(chunk)
    output += decoder.decode(chunk, { stream: true })
  }
  return { code: await proc.exited, output }
}

export function registerAttestCommand({ program }: CommandContext): void {
  program
    .command('attest')
    .description(
      "Run a platform's suite on this checkout and post the result as the sim/<platform> status on the PR's head commit",
    )
    .addArgument(new Argument('<platform>').choices(ATTEST_PLATFORMS))
    .action(async (platform: AttestPlatform) => {
      const uncommitted = await capture(['git', 'status', '--porcelain', '--untracked-files=no'])
      const head = await capture(['git', 'rev-parse', 'HEAD'])
      if (uncommitted.code !== 0 || head.code !== 0) {
        throw new Error(`git failed: ${(uncommitted.err || head.err).trim()}`)
      }
      const pr = await currentPullRequest()
      const refusal = attestRefusal({
        uncommitted: uncommitted.out,
        localHead: head.out.trim(),
        pr,
      })
      if (refusal || !pr) throw new Error(refusal ?? 'No pull request')

      if (platform === 'desktop') {
        const identity = desktopIdentity()
        const unavailable = desktopUnavailable(identity)
        if (unavailable) throw new Error(`${unavailable}\n${desktopSetup(identity.context)}`)
      }
      const suite = ATTEST_SUITES[platform]
      if ((await findScenarios(suite.filters)).length === 0) {
        throw new Error(
          `No scenarios match ${suite.filters.join(' ')} on this branch, so there is nothing to attest for ${platform}.`,
        )
      }

      const { code, output } = await runSuite([...suite.filters, ...suite.options])
      const status = attestStatus(code, parseRunSummary(output))
      if ('refused' in status) {
        throw new Error(`${status.refused} Nothing was posted for sim/${platform}.`)
      }
      const repo = repoFromPrUrl(pr.url)
      const posted = await capture([
        'gh',
        'api',
        `repos/${repo}/statuses/${pr.headRefOid}`,
        '-f',
        `state=${status.state}`,
        '-f',
        `context=sim/${platform}`,
        '-f',
        `description=${status.description}`,
      ])
      if (posted.code !== 0) throw new Error(`Posting the status failed: ${posted.err.trim()}`)
      console.log(
        `posted sim/${platform} ${status.state} on ${pr.headRefOid.slice(0, 9)} (PR #${pr.number}): ${status.description}`,
      )
      process.exitCode = status.state === 'success' ? 0 : 1
    })
}

/**
 * Posts the progress of the suite another step is running, every minute, as
 * the pending sim/<platform> status, since GitHub serves a job's log only once
 * the job ends. It reads the run's SIM_PROGRESS_FILE and posts to SHA in
 * GITHUB_REPOSITORY. A post that landed after the job's final status would
 * replace it, so SIGTERM lets a post in flight finish and then exits, and the
 * step waits for that exit before posting the result.
 */
export function registerCiProgressCommand({ program }: CommandContext): void {
  program
    .command('ci-progress')
    .description(
      "In CI, post a running suite's progress as its pending status every minute until stopped",
    )
    .addArgument(new Argument('<platform>').choices(ATTEST_PLATFORMS))
    .action(async (platform: AttestPlatform) => {
      const { GITHUB_REPOSITORY: repo, SHA: sha, SIM_PROGRESS_FILE: file } = process.env
      if (!repo || !sha || !file) {
        throw new Error('ci-progress needs GITHUB_REPOSITORY, SHA and SIM_PROGRESS_FILE')
      }
      const runUrl = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
      let stopping = false
      let wake = () => {}
      process.on('SIGTERM', () => {
        stopping = true
        wake()
      })
      while (!stopping) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 60_000)
          wake = () => {
            clearTimeout(timer)
            resolve()
          }
        })
        if (stopping || !existsSync(file)) continue
        const description = progressDescription(JSON.parse(readFileSync(file, 'utf8')) as Progress)
        await capture([
          'gh',
          'api',
          `repos/${repo}/statuses/${sha}`,
          '-f',
          'state=pending',
          '-f',
          `context=sim/${platform}`,
          '-f',
          `description=${description}`,
          '-f',
          `target_url=${runUrl}`,
        ])
      }
    })
}
