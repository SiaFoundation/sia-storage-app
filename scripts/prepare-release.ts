// Builds every release train's PR from main (see release-trains.ts and
// RELEASING.md). Runs on each push to main and after each publish. Finalize
// Release runs it with RELEASE_MODE=final, RELEASE_APP and SHIPPED_CANDIDATE
// to open an app's final PR first.
//
// Every train's cut is built on main's tip. Knope versions every package with
// a changeset, so each cut moves the changesets it doesn't release out of the
// tree while knope runs. A final cut keeps only the changesets its candidate
// shipped, so work merged after the candidate stays pending for the next
// version, and the stable tag still goes on the candidate's own commit.
//
// An open release PR is rebuilt only when main changes a file its release
// commit changes or one of its train's changesets. A rebuild restarts the
// PR's checks, including its sim runs, so a push that touches nothing a PR
// depends on leaves it alone.

import { execFileSync, spawnSync } from 'child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { deriveAppVersion } from '../apps/mobile/appVersion'
import {
  type AppName,
  isCandidate,
  marketingVersion,
  parseChangeset,
} from '../apps/mobile/scripts/releaseNotes'
import { writeCandidateNotes, writeFinalNotes } from '../apps/mobile/scripts/writeReleaseNotes'
import { NOTES_NOT_WRITTEN, closePr, openPr, publishPr } from './create-release-pr'
import { type Store, headerLine, storeLine } from './release-header'
import {
  GATED,
  type PendingChangeset,
  type Shipped,
  TRAINS,
  type Train,
  candidateBranch,
  candidateFile,
  candidateTag,
  changesetTrain,
  finalBranch,
  isStale,
  nextCandidate,
  parseCandidateTag,
  shipped,
  trainNamed,
  wasShipped,
} from './release-trains'

const MAIN = 'origin/main'

type GatedTrain = Train & { app: AppName }

/** An open final PR: its number, the version it releases, its candidate and its head commit. */
type Final = { number: number; version: string; candidate: string; head: string }

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function lines(output: string): string[] {
  return output.split('\n').filter(Boolean)
}

function changesetsAt(ref: string): PendingChangeset[] {
  return lines(git('ls-tree', '--name-only', `${ref}:.changeset`))
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const { packages, text } = parseChangeset(git('show', `${ref}:.changeset/${file}`))
      return { file, packages, text }
    })
}

function belongs(changeset: PendingChangeset, train: Train): boolean {
  return changeset.packages.some((p) => train.packages.includes(p))
}

/** The train's changesets on main. One that spans trains stops the run. */
function pendingOn(train: Train): PendingChangeset[] {
  return changesetsAt(MAIN).filter((changeset) => {
    const owner = changesetTrain(changeset.packages)
    if (typeof owner === 'string') throw new Error(`.changeset/${changeset.file} ${owner}`)
    return owner.name === train.name
  })
}

function versionAt(ref: string, app: AppName): string {
  return JSON.parse(git('show', `${ref}:apps/${app}/package.json`)).version
}

function versionNow(app: AppName): string {
  return JSON.parse(readFileSync(`apps/${app}/package.json`, 'utf-8')).version
}

function candidateVersions(app: AppName): string[] {
  return lines(git('tag', '--list', `${app}/v*-rc.*`)).map((tag) => tag.replace(`${app}/v`, ''))
}

function tagExists(tag: string): boolean {
  return git('tag', '--list', tag) !== ''
}

function shippedBy(tag: string): Shipped {
  const candidate = parseCandidateTag(tag)
  if (!candidate) throw new Error(`${tag} is not a candidate tag`)
  const files = new Map(changesetsAt(tag).map((c) => [c.file, c.packages]))
  return shipped(files, git('show', `${tag}:apps/${candidate.app}/CHANGELOG.md`), candidate.version)
}

/** Whether main has changed what the open PR on `branch` depends on since it was cut. */
function stale(branch: string, train: Train): boolean {
  const head = `origin/${branch}`
  const base = git('merge-base', head, MAIN)
  if (base === git('rev-parse', MAIN)) return false
  const changesets = [...changesetsAt(base), ...changesetsAt(MAIN)]
    .filter((c) => belongs(c, train))
    .map((c) => `.changeset/${c.file}`)
  // Every cut changes bun.lock, which records each package's version, but in
  // that package's own block, so cuts of different trains merge cleanly.
  // Watching it would rebuild every open release PR, and wipe its sim runs,
  // whenever any train releases.
  const touched = lines(git('diff', '--name-only', base, head)).filter((f) => f !== 'bun.lock')
  return isStale(lines(git('diff', '--name-only', base, MAIN)), [...touched, ...changesets])
}

function startBranch(branch: string): void {
  execFileSync('git', ['checkout', '--force', '-B', branch, MAIN], { stdio: 'inherit' })
  execFileSync('git', ['clean', '-fd', '--', '.changeset'], { stdio: 'inherit' })
}

/**
 * Runs knope with only `keep` of the changesets in the tree. The rest are
 * copied aside and put back after, rather than renamed, since the temporary
 * directory can be on another disk.
 */
function knope(keep: PendingChangeset[], args: string[]): void {
  const kept = new Set(keep.map((c) => c.file))
  const aside = mkdtempSync(join(tmpdir(), 'changesets-'))
  const moved = readdirSync('.changeset').filter((f) => f.endsWith('.md') && !kept.has(f))
  for (const file of moved) {
    cpSync(join('.changeset', file), join(aside, file))
    rmSync(join('.changeset', file))
  }
  try {
    execFileSync('knope', ['prepare-release', '--verbose', ...args], { stdio: 'inherit' })
  } finally {
    for (const file of moved) cpSync(join(aside, file), join('.changeset', file))
    rmSync(aside, { recursive: true, force: true })
  }
}

/**
 * Commits the cut and force-pushes it to `branch`. With `expected`, the push
 * goes through only while the branch is still at that commit, and returns
 * false when it has moved.
 */
function commitAndPush(branch: string, message: string, expected?: string): boolean {
  execFileSync('git', ['add', '-A'], { stdio: 'inherit' })
  if (git('diff', '--cached', '--name-only') === '') {
    throw new Error(`knope prepared nothing for ${branch}`)
  }
  execFileSync('git', ['commit', '-m', message], { stdio: 'inherit' })
  const force = expected ? `--force-with-lease=refs/heads/${branch}:${expected}` : '--force'
  const push = spawnSync('git', ['push', force, 'origin', `HEAD:refs/heads/${branch}`], {
    encoding: 'utf-8',
  })
  process.stderr.write(push.stderr)
  if (push.status === 0) return true
  if (expected && /stale info|\[rejected\]/.test(push.stderr)) return false
  throw new Error(`pushing ${branch} failed`)
}

function openFinals(): Map<AppName, Final> {
  const finals = new Map<AppName, Final>()
  for (const { app } of GATED) {
    const pr = openPr(finalBranch(app))
    if (!pr) continue
    const candidate = parseCandidateTag(
      git('show', `origin/${finalBranch(app)}:${candidateFile(app)}`),
    )
    if (!candidate) throw new Error(`#${pr.number} names no candidate`)
    finals.set(app, {
      number: pr.number,
      version: marketingVersion(candidate.version),
      candidate: candidate.version,
      head: git('rev-parse', `origin/${finalBranch(app)}`),
    })
  }
  return finals
}

/**
 * Runs knope for a candidate and returns its version. A candidate number is
 * never used twice, because its tag and its store build number already exist.
 * Knope can pick a used one when an older candidate was finalized after main
 * had moved to a newer version, so the cut is redone with the next free
 * number. `pinned` is the version an open final PR keeps.
 */
function cutCandidate(
  app: AppName,
  pending: PendingChangeset[],
  pinned: string | null,
  onMain: string,
): string {
  const used = [onMain, ...candidateVersions(app)]
  const pin = (marketing: string) => [
    '--override-version',
    `${app}=${nextCandidate(marketing, used)}`,
  ]
  knope(pending, ['--prerelease-label', 'rc', ...(pinned ? pin(pinned) : [])])
  const cut = versionNow(app)
  if (!used.includes(cut)) return cut
  execFileSync('git', ['checkout', '--force', '--', '.'], { stdio: 'inherit' })
  knope(pending, ['--prerelease-label', 'rc', ...pin(marketingVersion(cut))])
  return versionNow(app)
}

function appTitle(app: AppName): string {
  return app === 'mobile' ? 'Mobile' : 'Desktop'
}

/**
 * Cuts the gated train's next candidate when it has changes its newest one
 * doesn't. While the app's final PR is open the candidate keeps that version,
 * so a fix made during store review goes to the same store version.
 */
function prepareCandidate(train: GatedTrain, final: Final | undefined): void {
  const { app } = train
  const branch = candidateBranch(train.name)
  const pending = pendingOn(train)
  const version = versionAt(MAIN, app)
  const newest = isCandidate(version) ? candidateTag(app, version) : null
  if (newest && !tagExists(newest)) {
    console.log(
      `${train.name}: ${newest} isn't tagged yet. Publish Release runs this again once it is`,
    )
    return
  }
  const by = newest ? shippedBy(newest) : null
  const open = openPr(branch)
  if (!pending.some((c) => !by || !wasShipped(c, app, by))) {
    console.log(`${train.name}: nothing new since ${newest ?? 'the last release'}`)
    if (open) closePr(branch, `Nothing new to release since ${newest ?? 'the last release'}.`)
    return
  }
  if (
    open &&
    !open.body.includes(NOTES_NOT_WRITTEN) &&
    (!final || marketingVersion(versionAt(`origin/${branch}`, app)) === final.version) &&
    !stale(branch, train)
  ) {
    console.log(`${train.name}: #${open.number} is up to date`)
    return
  }

  startBranch(branch)
  const cut = cutCandidate(app, pending, final?.version ?? null, version)
  const problem = writeCandidateNotes(app)
  commitAndPush(branch, `chore: release ${app} ${cut}`)
  const inReview = final
    ? `${appTitle(app)} ${final.version} from ${final.candidate} is in #${final.number}, so this candidate stays ${final.version}.`
    : null
  publishPr(branch, { kind: 'candidate', train, app, version: cut, inReview }, problem, false)
}

/**
 * Builds the app's final PR for the candidate `tag`. `submitted` is set when
 * Finalize Release has just sent the candidate to store review, which starts
 * the store lines over and turns a mobile final PR back into a draft until
 * both stores approve it.
 *
 * `rebuilding` is the head of an open final PR being rebuilt against a newer
 * main. Finalize Release can replace that PR with another candidate meanwhile,
 * so the rebuild is pushed only while the branch is still at that head.
 */
function prepareFinal(
  train: GatedTrain,
  tag: string,
  submitted: boolean,
  rebuilding?: string,
): void {
  const { app } = train
  const candidate = parseCandidateTag(tag)
  if (candidate?.app !== app) throw new Error(`${tag} is not a ${app} candidate tag`)
  const version = marketingVersion(candidate.version)
  if (versionAt(MAIN, app) === version) throw new Error(`${app} ${version} is already released`)
  const pending = pendingOn(train)
  const by = shippedBy(tag)
  const releases = pending.filter((c) => wasShipped(c, app, by))
  if (releases.length === 0) throw new Error(`none of ${tag}'s changesets are pending on main`)
  const branch = finalBranch(app)
  const open = openPr(branch)

  startBranch(branch)
  knope(releases, ['--override-version', `${app}=${version}`])
  writeFileSync(candidateFile(app), `${tag}\n`)
  writeFinalNotes(app, tag)
  if (!commitAndPush(branch, `chore: release ${app} ${version}`, rebuilding)) {
    console.log(`${app} final: ${branch} changed during the rebuild, leaving it`)
    return
  }
  const kept = (store: Store) =>
    (!submitted && open && headerLine(open.body, `${store}:`)) ||
    storeLine(store, 'Waiting for review', new Date())
  publishPr(
    branch,
    {
      kind: 'final',
      train,
      app,
      version,
      candidate: candidate.version,
      buildNumber: deriveAppVersion(candidate.version).buildNumber,
      appStore: kept('App Store'),
      googlePlay: kept('Google Play'),
      deferred: pending.filter((c) => !releases.includes(c)).map((c) => c.text),
    },
    null,
    app === 'mobile' && submitted,
  )
}

function preparePackages(train: Train): void {
  const branch = candidateBranch(train.name)
  const pending = pendingOn(train)
  const open = openPr(branch)
  if (pending.length === 0) {
    console.log(`${train.name}: nothing to release`)
    if (open) closePr(branch, 'Nothing left to release.')
    return
  }
  if (open && !stale(branch, train)) {
    console.log(`${train.name}: #${open.number} is up to date`)
    return
  }
  startBranch(branch)
  knope(pending, [])
  commitAndPush(branch, 'chore: release packages')
  publishPr(branch, { kind: 'packages', train }, null, false)
}

function gated(name: string): GatedTrain {
  const train = trainNamed(name)
  if (!train.app) throw new Error(`the ${name} train has no candidates to finalize`)
  return { ...train, app: train.app }
}

/**
 * The candidate to finalize: the one named, or the newest one main records.
 * Main records no candidate once a final has merged, so then it must be named.
 */
function candidateToFinalize(app: AppName): string {
  const named = process.env.SHIPPED_CANDIDATE?.trim()
  if (named) return named
  const version = versionAt(MAIN, app)
  if (!isCandidate(version)) {
    throw new Error(`main has ${app} ${version}, not a candidate. Name the candidate to finalize`)
  }
  return candidateTag(app, version)
}

const failures: string[] = []

/** Runs one train's step. A failed train is reported and holds back no other. */
function step(name: string, run: () => void): void {
  try {
    run()
  } catch (error) {
    console.error(`ERROR: ${name}: ${error}`)
    failures.push(name)
  }
}

execFileSync('git', ['fetch', '--quiet', '--prune', '--tags', '--force', 'origin'], {
  stdio: 'inherit',
})
// Git can't hold a `release` branch next to `release/<train>` ones, so every
// push would fail on that ref.
if (git('ls-remote', '--heads', 'origin', 'refs/heads/release') !== '') {
  throw new Error(
    'the old release branch still exists, which blocks every release/<train> branch. Close its PR, delete it with `git push origin --delete release`, and run Prepare Release again',
  )
}

// Finalize Release builds only the final. The Prepare Release run it starts
// after rebuilds the other release PRs, which then keep the final's version.
const finalApp = process.env.RELEASE_MODE === 'final' ? process.env.RELEASE_APP : undefined
if (finalApp) {
  const train = gated(finalApp)
  prepareFinal(train, candidateToFinalize(train.app), true)
  process.exit(0)
}

// Every final PR main has moved under is rebuilt first, since the candidate
// trains read the open finals to keep their versions.
for (const [app, final] of openFinals()) {
  const train = gated(app)
  if (!stale(finalBranch(app), train)) continue
  step(`${app} final`, () =>
    prepareFinal(train, candidateTag(app, final.candidate), false, final.head),
  )
}
const finals = openFinals()
for (const train of TRAINS) {
  const { app } = train
  step(train.name, () =>
    app ? prepareCandidate({ ...train, app }, finals.get(app)) : preparePackages(train),
  )
}
if (failures.length > 0) {
  console.error(`failed: ${failures.join(', ')}`)
  process.exit(1)
}
