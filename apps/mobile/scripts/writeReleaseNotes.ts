/**
 * Writes the release notes into the release commit. Called by
 * scripts/prepare-release.ts after knope has bumped the versions.
 *
 * For a release candidate it asks Copilot, in one call, for the What's New
 * entry and the tester notes of every app in the round, from each app's
 * changelog. For a final cut it only dates each candidate's entry: the stable
 * release reuses the candidate's build, so the entry that build bundled is the
 * one its users get.
 *
 * The model runs with every tool denied, in an empty directory, and without
 * the release bot's token, so text in a changeset can steer what it writes but
 * cannot reach the checkout or the bot token. Its output is checked here and
 * again in CI, and reviewed in the release PR.
 */

import { type SpawnSyncReturns, execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  APPS,
  APP_NAMES,
  type AppName,
  CHANGESET_DIR,
  type Changeset,
  GUIDE_FILE,
  type GeneratedNotes,
  type RoundChanges,
  TESTING_FILE,
  type WhatsNewEntry,
  candidateChanges,
  entryPlatforms,
  isCandidate,
  marketingVersion,
  notesPrompt,
  packageVersion,
  parseChangeset,
  parseGenerated,
  readTesting,
  readWhatsNew,
  whatsNewFile,
} from './releaseNotes'

const COPILOT = '@github/copilot@1.0.114'
// Copilot picks the model. Under a workflow token it refuses Opus models by name.
const MODEL = 'auto'
/** Whether knope bumped the app's version in this cut. */
function inCut(app: AppName): boolean {
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'package.json'], { cwd: APPS[app].dir })
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

function generate(
  round: RoundChanges,
  drafts: Partial<Record<AppName, WhatsNewEntry>>,
): GeneratedNotes {
  const prompt = notesPrompt(readFileSync(GUIDE_FILE, 'utf-8'), round, drafts)
  const reply = ask(prompt)
  try {
    return parseGenerated(reply, round)
  } catch (error) {
    console.warn(`the first reply was rejected (${error}), asking again`)
    return parseGenerated(
      ask(`${prompt}\n\nYour previous reply was rejected: ${error}. Reply again.`),
      round,
    )
  }
}

/**
 * The pending changesets. Knope keeps them across release candidates and
 * deletes them only at a stable release, so every entry in a candidate's
 * changelog section still has its file here.
 */
function pendingChangesets(): Changeset[] {
  return readdirSync(CHANGESET_DIR)
    .filter((file) => file.endsWith('.md'))
    .map((file) => parseChangeset(readFileSync(path.join(CHANGESET_DIR, file), 'utf-8')))
}

function writeCandidateNotes(apps: AppName[]): void {
  const changesets = pendingChangesets()
  const round: RoundChanges = {}
  for (const app of apps) {
    const changelog = readFileSync(path.join(APPS[app].dir, 'CHANGELOG.md'), 'utf-8')
    round[app] = candidateChanges(changelog, packageVersion(app), (entry) =>
      entryPlatforms(app, entry, changesets),
    )
  }
  const drafts: Partial<Record<AppName, WhatsNewEntry>> = {}
  for (const app of apps) {
    const marketing = marketingVersion(packageVersion(app))
    const draft = readWhatsNew(app).find((e) => e.version === marketing)
    if (draft) drafts[app] = draft
  }
  const notes = generate(round, drafts)

  for (const app of apps) {
    const items = notes.whatsNew[app]
    if (!items) continue
    const entry = { version: marketingVersion(packageVersion(app)), released: null, items }
    writeJson(whatsNewFile(app), withEntry(readWhatsNew(app), entry))
  }
  // An app outside this round keeps its notes, which still describe the
  // candidate its testers have.
  const testing = readTesting()
  for (const app of apps) {
    const changes = round[app]
    const written = notes.testing[app]
    if (!changes || !written) continue
    testing[app] = {
      version: changes.version,
      sinceCandidate: changes.candidate && {
        from: changes.candidate.from,
        items: written.sinceCandidate,
      },
      sinceRelease: { from: changes.from, items: written.sinceRelease },
    }
  }
  writeJson(TESTING_FILE, testing)
}

/**
 * Dates the candidate's entry. Only mobile's is required, because the store
 * submission sends it: desktop's What's New is not read by anything yet, so a
 * candidate cut without one still finalizes.
 */
function dateFinalEntry(app: AppName): void {
  const version = packageVersion(app)
  const entries = readWhatsNew(app)
  const entry = entries.find((e) => e.version === version)
  if (!entry && app !== 'mobile') return
  if (!entry) throw new Error(`the candidate has no What's New entry for ${app} ${version}`)
  const released = new Date().toISOString().slice(0, 10)
  writeJson(whatsNewFile(app), withEntry(entries, { ...entry, released }))
}

/**
 * Writes the notes for this cut. Returns why they could not be written, for
 * the release PR to show, rather than throwing: a failed model call must not
 * stop the cut, and CI keeps the PR from merging until the notes exist.
 */
export function writeReleaseNotes(final: boolean): string | null {
  const apps = APP_NAMES.filter(inCut)
  try {
    if (final) {
      for (const app of apps) dateFinalEntry(app)
    } else {
      const candidates = apps.filter((app) => isCandidate(packageVersion(app)))
      if (candidates.length > 0) writeCandidateNotes(candidates)
    }
    return null
  } catch (error) {
    console.error(`WARNING: release notes were not written: ${error}`)
    return `${error}`
  }
}
