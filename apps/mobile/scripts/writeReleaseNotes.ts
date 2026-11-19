/**
 * Writes the mobile release notes into the release commit. Called by
 * scripts/prepare-release.ts after knope has bumped the versions.
 *
 * For a release candidate it asks Copilot for the What's New entry and the
 * tester notes, from the mobile changelog. For a final cut it only dates the
 * candidate's entry: the store submission reuses the candidate's build, so the
 * entry that build bundled is the one the stores get.
 *
 * The model runs with every tool denied, in an empty directory, and without
 * the release bot's token, so text in a changeset can steer what it writes but
 * cannot reach the checkout or the bot token. Its output is checked here and
 * again in CI, and reviewed in the release PR.
 */

import { type SpawnSyncReturns, execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  GUIDE_FILE,
  TESTING_FILE,
  type TestingNotes,
  WHATS_NEW_FILE,
  type WhatsNewEntry,
  candidateChanges,
  isCandidate,
  marketingVersion,
  notesPrompt,
  parseGenerated,
  readWhatsNew,
} from './releaseNotes'

const COPILOT = '@github/copilot@1.0.114'
// Copilot picks the model. Under a workflow token it refuses Opus models by name.
const MODEL = 'auto'
const MOBILE_DIR = path.resolve(import.meta.dir, '..')

function mobileVersion(): string {
  return JSON.parse(readFileSync(path.join(MOBILE_DIR, 'package.json'), 'utf-8')).version
}

/** Whether knope bumped the mobile version in this cut. */
function mobileInCut(): boolean {
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'package.json'], { cwd: MOBILE_DIR })
    return false
  } catch {
    return true
  }
}

function ask(prompt: string): string {
  const token = process.env.COPILOT_GITHUB_TOKEN
  if (!token) throw new Error('COPILOT_GITHUB_TOKEN is not set')
  const sandbox = mkdtempSync(path.join(tmpdir(), 'release-notes-'))
  try {
    return replyOf(runCopilot(prompt, sandbox, token))
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

function replyOf(run: SpawnSyncReturns<string>): string {
  if (run.status === 0) return run.stdout
  // The thrown message goes into the public release PR's description, so it
  // names only how the CLI ended. What the CLI printed goes to the job log
  // alone, where Actions masks the token.
  console.error(`Copilot CLI output:\n${run.stderr.slice(-4000)}`)
  throw new Error(
    `the Copilot CLI failed (${run.error?.message ?? run.signal ?? `exit ${run.status}`})`,
  )
}

/**
 * The run's GITHUB_* and RUNNER_* variables pass through, as GitHub's own
 * agentic workflows give the CLI the run's context, except GITHUB_TOKEN, which
 * in Prepare Release is the release bot's app token.
 */
function cliEnv(sandbox: string, token: string): NodeJS.ProcessEnv {
  const context = Object.entries(process.env).filter(
    ([name, value]) =>
      value !== undefined && /^(GITHUB|RUNNER)_/.test(name) && name !== 'GITHUB_TOKEN',
  )
  return {
    ...Object.fromEntries(context),
    CI: process.env.CI,
    PATH: process.env.PATH,
    HOME: sandbox,
    COPILOT_GITHUB_TOKEN: token,
    NODE_ENV: 'production',
  }
}

function runCopilot(prompt: string, sandbox: string, token: string): SpawnSyncReturns<string> {
  return spawnSync(
    'bunx',
    [
      '--bun',
      COPILOT,
      '--prompt',
      prompt,
      '--silent',
      '--model',
      MODEL,
      '--no-ask-user',
      '--no-auto-update',
      '--no-custom-instructions',
      '--disable-builtin-mcps',
      '--deny-tool=shell',
      '--deny-tool=read',
      '--deny-tool=write',
      '--deny-tool=url',
      '--deny-tool=memory',
    ],
    {
      cwd: sandbox,
      encoding: 'utf-8',
      env: cliEnv(sandbox, token),
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    },
  )
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
  execFileSync('bunx', ['oxfmt', '--write', file], { stdio: 'inherit' })
}

function withEntry(entries: WhatsNewEntry[], entry: WhatsNewEntry): WhatsNewEntry[] {
  return [entry, ...entries.filter((e) => e.version !== entry.version)]
}

function writeCandidateNotes(version: string): void {
  const changes = candidateChanges(
    readFileSync(path.join(MOBILE_DIR, 'CHANGELOG.md'), 'utf-8'),
    version,
  )
  const marketing = marketingVersion(version)
  const entries = readWhatsNew()
  const draft = entries.find((e) => e.version === marketing) ?? null
  const prompt = notesPrompt(readFileSync(GUIDE_FILE, 'utf-8'), changes, draft)

  const newSinceCandidate = changes.sinceCandidate?.entries.length ?? null
  let reply = ask(prompt)
  let notes: ReturnType<typeof parseGenerated>
  try {
    notes = parseGenerated(reply, newSinceCandidate)
  } catch (error) {
    console.warn(`the first reply was rejected (${error}), asking again`)
    reply = ask(`${prompt}\n\nYour previous reply was rejected: ${error}. Reply again.`)
    notes = parseGenerated(reply, newSinceCandidate)
  }

  const testing: TestingNotes = {
    version,
    sinceCandidate: changes.sinceCandidate && {
      from: changes.sinceCandidate.from,
      items: notes.sinceCandidate,
    },
    sinceRelease: { from: changes.sinceRelease.from, items: notes.sinceRelease },
  }
  writeJson(
    WHATS_NEW_FILE,
    withEntry(entries, { version: marketing, released: null, items: notes.whatsNew }),
  )
  writeJson(TESTING_FILE, testing)
}

function dateFinalEntry(version: string): void {
  const entries = readWhatsNew()
  const entry = entries.find((e) => e.version === version)
  if (!entry) {
    throw new Error(`the candidate has no What's New entry for ${version}`)
  }
  const released = new Date().toISOString().slice(0, 10)
  writeJson(WHATS_NEW_FILE, withEntry(entries, { ...entry, released }))
}

/**
 * Writes the notes for this cut. Returns why they could not be written, for
 * the release PR to show, rather than throwing: a failed model call must not
 * stop the cut, and CI keeps the PR from merging until the notes exist.
 */
export function writeReleaseNotes(final: boolean): string | null {
  if (!mobileInCut()) return null
  const version = mobileVersion()
  try {
    if (final) dateFinalEntry(version)
    else if (isCandidate(version)) writeCandidateNotes(version)
    return null
  } catch (error) {
    console.error(`WARNING: release notes for mobile ${version} were not written: ${error}`)
    return `${error}`
  }
}
