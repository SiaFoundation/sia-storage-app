// Creates the tags and GitHub releases for a cut, pinned to an explicit commit.
//
// Knope tags whatever HEAD happens to be (`git::get_head_commit_sha`, with no
// way to override), which is only right when the release commit is the tip. A
// graduated release is prepared from the shipped candidate's tag while main has
// moved on, so tagging on merge would put `mobile/v1.14.0` on a commit holding
// work that never shipped. release-cli.yml builds whatever its tag points at,
// so a misplaced tag means binaries that don't match their own release notes.
//
// publish  tags each package at `ref` under the version it already carries, for
//          when a release PR merges and main's tip is the cut.
// promote  graduates an rc cut: packages carrying `-rc.N` are tagged at that
//          same commit under the stripped version, so `mobile/v1.14.0` and
//          `mobile/v1.14.0-rc.1` name one commit, which is on main, is the
//          source that shipped, and carries its own changelog entry. Knope
//          retains change files across rc runs, so the last rc's entry already
//          lists everything the cut contains and serves as the stable notes.
//
// `ref` is always a tag or a merge commit, so a re-run resolves the same way
// months later. Preparing a cut twice yields an identical tree under a fresh
// sha, so tags are compared by tree: an unchanged release is refreshed in place
// rather than deleted and recreated.
//
// The repository's releases are immutable: once published, a release can gain
// no file, and its tag can never be moved or reused. A package whose release
// carries files is created as a draft, on a tag made first, and its build
// workflow is started from that tag. The workflow attaches the files and then
// publishes the draft. Any other package is published at once.

import { execFileSync } from 'child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const RC_SUFFIX = /-rc\.\d+$/

/**
 * The workflow that builds and attaches each package's release files, and the
 * inputs that make it attach them to the release it is started for.
 */
const ASSET_WORKFLOWS: Record<string, { file: string; inputs: (tag: string) => string[] }> = {
  desktop: { file: 'release-desktop.yml', inputs: (tag) => ['tag=' + tag, 'upload=true'] },
  cli: {
    file: 'release-cli.yml',
    inputs: (tag) => ['tag=' + tag, 'upload_to_latest_release=true'],
  },
}

// Written by a graduating cut (see prepare-release.ts) and read back here.
const CANDIDATE_FILE = '.release-candidate'

type Package = { name: string; versionedFile: string; changelog: string }

function knopePackages(): Package[] {
  const toml = readFileSync('knope.toml', 'utf-8')
  const packages: Package[] = []
  for (const section of toml.split(/^\[packages\./m).slice(1)) {
    // Stop at the next top-level section so a later one can't satisfy a field
    // the package block itself omitted.
    const end = section.search(/^\[/m)
    const block = end === -1 ? section : section.slice(0, end)
    const name = block.slice(0, block.indexOf(']'))
    const versionedFile = /versioned_files\s*=\s*\[\s*"([^"]+)"/.exec(block)?.[1]
    const changelog = /changelog\s*=\s*"([^"]+)"/.exec(block)?.[1]
    if (!versionedFile || !changelog) {
      throw new Error(`knope.toml package "${name}" is missing versioned_files or changelog`)
    }
    packages.push({ name, versionedFile, changelog })
  }
  if (packages.length === 0) throw new Error('knope.toml declares no [packages.*] entries')
  return packages
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function treeOf(commit: string): string {
  return git(['rev-parse', `${commit}^{tree}`])
}

// A cut is exactly the packages whose changelog moved in it, which is what
// separates them from packages sitting at a version an earlier cut released.
// Derived from the commit's own parent, so it needs no state beyond `ref`.
function changedIn(ref: string, path: string): boolean {
  try {
    execFileSync('git', ['diff', '--quiet', `${ref}^`, ref, '--', path], { stdio: 'ignore' })
    return false
  } catch {
    return true
  }
}

function fileAt(ref: string, path: string): string | null {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

/**
 * Runs a gh lookup, returning null only when gh reports that the thing does
 * not exist. Any other failure throws: `publish` deletes and recreates tags
 * when a lookup comes back empty, so an auth error or outage read as "no
 * release" would delete a tag that has one.
 */
function ghLookup(args: string[]): string | null {
  try {
    return execFileSync('gh', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error) {
    // `gh release view` prints "release not found", `gh api` prints "Not Found (HTTP 404)".
    const stderr = String((error as { stderr?: unknown }).stderr ?? '')
    if (/release not found|\(HTTP 404\)/.test(stderr)) return null
    throw error
  }
}

function ghRun(args: string[]): void {
  if (process.env.DRY_RUN === 'true') {
    console.log(`  would run: gh ${args.join(' ')}`)
    return
  }
  execFileSync('gh', args, { stdio: 'inherit' })
}

function tagSha(tag: string): string | null {
  return ghLookup(['api', `repos/{owner}/{repo}/git/ref/tags/${tag}`, '--jq', '.object.sha'])
}

/** Whether `tag` has a release, and whether that release is still a draft. */
function releaseState(tag: string): 'published' | 'draft' | null {
  const isDraft = ghLookup(['release', 'view', tag, '--json', 'isDraft', '--jq', '.isDraft'])
  if (isDraft === null) return null
  return isDraft === 'true' ? 'draft' : 'published'
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Runs `attempt` until it succeeds, up to five times 5 seconds apart. A tag
 * made a moment ago can be missing from the next call that names it.
 */
function retried(what: string, attempt: () => void): void {
  for (let tries = 1; ; tries++) {
    try {
      attempt()
      return
    } catch (e) {
      if (tries === 5) throw e
      console.log(`  ${what} failed, trying again`)
      sleep(5_000)
    }
  }
}

/**
 * Starts the workflow that builds `name`'s files for `tag` and publishes its
 * draft, unless a run of it for that tag is already queued or running, as on
 * a re-run of this script while the first build is still going. A dispatch by
 * the workflow's own token starts a run, where a release event from that
 * token would not.
 */
function startBuild(name: string, tag: string): void {
  const workflow = ASSET_WORKFLOWS[name]
  if (!workflow) return
  const args = ['workflow', 'run', workflow.file, '--ref', tag]
  for (const input of workflow.inputs(tag)) args.push('-f', input)
  if (process.env.DRY_RUN === 'true') {
    console.log(`  would run: gh ${args.join(' ')}`)
    return
  }
  const token = process.env.DISPATCH_TOKEN
  if (!token) throw new Error(`set DISPATCH_TOKEN to start ${workflow.file} for ${tag}`)
  const env = { ...process.env, GH_TOKEN: token }
  const running = execFileSync(
    'gh',
    [
      'run',
      'list',
      '--workflow',
      workflow.file,
      '--branch',
      tag,
      '--json',
      'status',
      '--jq',
      '[.[] | select(.status != "completed")] | length',
    ],
    { encoding: 'utf-8', env },
  ).trim()
  if (running !== '0') {
    console.log(`  ${workflow.file} is already running for ${tag}`)
    return
  }
  retried(`starting ${workflow.file}`, () => execFileSync('gh', args, { stdio: 'inherit', env }))
}

// The heading carries the date the notes are titled with ("## 1.14.0 (2026-08-13)").
function latestEntry(changelog: string): { version: string; date: string; body: string } | null {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.startsWith('## '))
  if (start === -1) return null
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  const heading = lines[start].replace(/^## /, '').trim()
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim()
  return {
    version: heading.replace(/\s*\(.*\)/, '').trim(),
    date: /\(([^)]+)\)/.exec(heading)?.[1] ?? '',
    body,
  }
}

function withNotes(body: string, use: (notesFile: string) => void): void {
  const notesFile = join(tmpdir(), 'release-notes.md')
  writeFileSync(notesFile, body)
  try {
    use(notesFile)
  } finally {
    try {
      unlinkSync(notesFile)
    } catch {}
  }
}

// A merged release PR names its own kind in its title (see create-release-pr.ts),
// which is what separates graduating a shipped candidate from publishing a cut
// that main's tip already is.
function resolveInputs(): { ref: string; mode: 'publish' | 'promote' } {
  const explicitRef = process.env.PUBLISH_REF
  if (explicitRef) {
    return {
      ref: explicitRef,
      mode: process.env.PUBLISH_MODE === 'promote' ? 'promote' : 'publish',
    }
  }

  const mergeCommit = process.env.MERGE_COMMIT_SHA
  if (!mergeCommit) {
    throw new Error('set PUBLISH_REF, or MERGE_COMMIT_SHA when running from a merged release PR')
  }

  // Two signals, because the title is editable by hand and mistaking a
  // graduation for an ordinary cut would tag main's tip, the bug this exists to
  // prevent. Recording the candidate is the other half: a graduation always
  // writes it, and only an identical re-graduation leaves it unchanged.
  const graduation =
    (process.env.PR_TITLE ?? '').includes('(final)') || changedIn(mergeCommit, CANDIDATE_FILE)
  if (!graduation) {
    return { ref: mergeCommit, mode: 'publish' }
  }

  // A finalize cut records which candidate it graduated, so the commit to tag
  // survives the rebase that rewrites the release commit onto main.
  const candidate = fileAt(mergeCommit, CANDIDATE_FILE)?.trim()
  if (!candidate) {
    throw new Error(`${CANDIDATE_FILE} is missing at ${mergeCommit}; re-run with PUBLISH_REF set`)
  }
  return { ref: candidate, mode: 'promote' }
}

const { ref, mode } = resolveInputs()
let target: string
try {
  target = git(['rev-parse', `${ref}^{commit}`])
} catch {
  // A recorded candidate whose tag has since been deleted lands here, so name
  // the recovery rather than leaving a bare git error.
  throw new Error(`${ref} does not resolve to a commit; re-run with PUBLISH_REF set to one`)
}
const targetTree = treeOf(target)
console.log(`${mode} from ${ref} (${target.slice(0, 9)})`)

type Release = { name: string; tag: string; title: string; body: string; prerelease: boolean }

// What this cut owes a package, or null when the package is not part of it.
function releaseFor({ name, versionedFile, changelog }: Package): Release | null {
  if (!changedIn(target, changelog)) return null
  const manifest = fileAt(ref, versionedFile)
  if (!manifest) return null
  const version: string = JSON.parse(manifest).version

  // Promoting graduates only what the gate held back. A package the cut released
  // outright already carries its stable tag from the publish that merged it.
  if (mode === 'promote' && !RC_SUFFIX.test(version)) return null
  const tagVersion = mode === 'promote' ? version.replace(RC_SUFFIX, '') : version

  const entry = latestEntry(fileAt(ref, changelog) ?? '')
  if (!entry) return null
  if (entry.version !== version) {
    throw new Error(`${versionedFile} is ${version} but ${changelog} documents ${entry.version}`)
  }
  return {
    name,
    tag: `${name}/v${tagVersion}`,
    title: `${name} ${tagVersion}${entry.date ? ` (${entry.date})` : ''}`,
    body: entry.body,
    prerelease: RC_SUFFIX.test(tagVersion),
  }
}

function publish({ name, tag, title, body, prerelease }: Release): void {
  const withFiles = name in ASSET_WORKFLOWS
  let existing = tagSha(tag)
  let state = releaseState(tag)

  if (existing !== null && treeOf(existing) !== targetTree) {
    if (mode !== 'promote') {
      throw new Error(
        `${tag} points at ${existing.slice(0, 9)}, whose tree is not ${target.slice(0, 9)}'s`,
      )
    }
    // A published release locks its tag, and a deleted one's name can never be
    // used again, so only a draft or a bare tag can be moved.
    if (state === 'published') {
      throw new Error(
        `${tag} is published at ${existing.slice(0, 9)}, whose tree is not this cut's, and a published release's tag cannot be moved or reused`,
      )
    }
    console.log(`${tag}: retargeting, the tagged tree is not this cut`)
    if (state === 'draft') {
      ghRun(['release', 'delete', tag, '--yes', '--cleanup-tag'])
    } else {
      ghRun(['api', '-X', 'DELETE', `repos/{owner}/{repo}/git/refs/tags/${tag}`])
    }
    existing = null
    state = null
  }

  if (state !== null) {
    console.log(`${tag}: already ${state} at this tree, refreshing notes`)
    withNotes(body, (notes) =>
      ghRun(['release', 'edit', tag, '--title', title, '--notes-file', notes]),
    )
    // A draft whose build failed is waiting on another run.
    if (state === 'draft') startBuild(name, tag)
    return
  }

  // The tag comes first for a release with files, since its draft has none
  // until published and its build workflow is started from it.
  if (existing === null && withFiles) {
    console.log(`${tag}: tagging ${target.slice(0, 9)}`)
    ghRun([
      'api',
      'repos/{owner}/{repo}/git/refs',
      '-f',
      `ref=refs/tags/${tag}`,
      '-f',
      `sha=${target}`,
    ])
    existing = target
  }

  // An existing tag outlived a run that died before its release was created, so
  // the release attaches to it rather than moving it.
  const targetArg = existing === null ? ['--target', target] : ['--verify-tag']
  console.log(
    `${tag}: creating ${withFiles ? 'a draft' : 'the release'} at ${(existing ?? target).slice(0, 9)}`,
  )
  withNotes(body, (notes) =>
    retried(`creating ${tag}`, () =>
      ghRun([
        'release',
        'create',
        tag,
        ...targetArg,
        '--title',
        title,
        '--notes-file',
        notes,
        ...(prerelease ? ['--prerelease'] : []),
        ...(withFiles ? ['--draft'] : []),
      ]),
    ),
  )
  if (withFiles) startBuild(name, tag)
}

const releases = knopePackages()
  .map(releaseFor)
  .filter((release) => release !== null)
if (releases.length === 0) {
  throw new Error(`no package at ${ref} needs a ${mode}`)
}
for (const release of releases) publish(release)
console.log(`${releases.length} release(s) at ${target.slice(0, 9)}`)
