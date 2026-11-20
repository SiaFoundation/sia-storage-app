/**
 * Writes an app's release notes into its release commit. Called by
 * scripts/prepare-release.ts after knope has bumped the app's version.
 *
 * For a release candidate it asks Copilot for the app's What's New entry and
 * tester notes, from its changelog. For a final cut it copies the candidate's
 * own entry and dates it: the stable release reuses the candidate's build, so
 * the entry that build bundled is the one its users get.
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
  type AppName,
  CHANGESET_DIR,
  type Changeset,
  GUIDE_FILE,
  type GeneratedNotes,
  type RoundChanges,
  type WhatsNewEntry,
  candidateChanges,
  entryPlatforms,
  marketingVersion,
  notesPrompt,
  packageVersion,
  parseChangeset,
  parseGenerated,
  parseWhatsNew,
  readWhatsNew,
  testingFile,
  whatsNewFile,
} from './releaseNotes'

const COPILOT = '@github/copilot@1.0.114'
// Copilot picks the model. Under a workflow token it refuses Opus models by name.
const MODEL = 'auto'

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

function writeNotes(app: AppName): void {
  const changelog = readFileSync(path.join(APPS[app].dir, 'CHANGELOG.md'), 'utf-8')
  const changesets = pendingChangesets()
  const changes = candidateChanges(changelog, packageVersion(app), (entry) =>
    entryPlatforms(app, entry, changesets),
  )
  const marketing = marketingVersion(packageVersion(app))
  const draft = readWhatsNew(app).find((e) => e.version === marketing)
  const round: RoundChanges = { [app]: changes }
  const notes = generate(round, draft ? { [app]: draft } : {})

  const items = notes.whatsNew[app]
  const written = notes.testing[app]
  if (!items || !written) throw new Error(`the reply has no notes for ${app}`)
  writeJson(
    whatsNewFile(app),
    withEntry(readWhatsNew(app), { version: marketing, released: null, items }),
  )
  writeJson(testingFile(app), {
    version: changes.version,
    sinceCandidate: changes.candidate && {
      from: changes.candidate.from,
      items: written.sinceCandidate,
    },
    sinceRelease: { from: changes.from, items: written.sinceRelease },
  })
}

/**
 * Writes a candidate's notes. Returns why they could not be written, for the
 * release PR to show, rather than throwing: a failed model call must not stop
 * the cut, and CI keeps the PR from merging until the notes exist.
 */
export function writeCandidateNotes(app: AppName): string | null {
  try {
    writeNotes(app)
    return null
  } catch (error) {
    console.error(`WARNING: release notes were not written: ${error}`)
    return `${error}`
  }
}

/**
 * Writes the candidate's What's New entry, dated today, as the stable
 * version's. It comes from the candidate's own commit, since main can already
 * hold a later candidate's entry for the same version. Only mobile's is
 * required, because the store submission sends it.
 */
export function writeFinalNotes(app: AppName, candidateTag: string): void {
  const version = packageVersion(app)
  const file = `apps/${app}/release-notes/whats-new.json`
  const json = execFileSync('git', ['show', `${candidateTag}:${file}`], { encoding: 'utf-8' })
  const entry = parseWhatsNew(JSON.parse(json), app, file).find((e) => e.version === version)
  if (!entry && app === 'mobile') {
    throw new Error(`${candidateTag} has no What's New entry for ${version}`)
  }
  if (!entry) return
  const released = new Date().toISOString().slice(0, 10)
  writeJson(whatsNewFile(app), withEntry(readWhatsNew(app), { ...entry, released }))
}
