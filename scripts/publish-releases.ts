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

import { execFileSync } from 'child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const RC_SUFFIX = /-rc\.\d+$/

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

function ghCapture(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function ghRun(args: string[]): void {
  if (process.env.DRY_RUN === 'true') {
    console.log(`  would run: gh ${args.join(' ')}`)
    return
  }
  execFileSync('gh', args, { stdio: 'inherit' })
}

function tagSha(tag: string): string | null {
  try {
    return ghCapture(['api', `repos/{owner}/{repo}/git/ref/tags/${tag}`, '--jq', '.object.sha'])
  } catch {
    return null
  }
}

function releaseExists(tag: string): boolean {
  try {
    execFileSync('gh', ['release', 'view', tag], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
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

type Release = { tag: string; title: string; body: string; prerelease: boolean }

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
    tag: `${name}/v${tagVersion}`,
    title: `${name} ${tagVersion}${entry.date ? ` (${entry.date})` : ''}`,
    body: entry.body,
    prerelease: RC_SUFFIX.test(tagVersion),
  }
}

function publish({ tag, title, body, prerelease }: Release): void {
  let existing = tagSha(tag)

  if (existing !== null && treeOf(existing) !== targetTree) {
    if (mode !== 'promote') {
      throw new Error(
        `${tag} points at ${existing.slice(0, 9)}, whose tree is not ${target.slice(0, 9)}'s`,
      )
    }
    console.log(`${tag}: retargeting, the tagged tree is not this cut`)
    if (releaseExists(tag)) {
      ghRun(['release', 'delete', tag, '--yes', '--cleanup-tag'])
    } else {
      ghRun(['api', '-X', 'DELETE', `repos/{owner}/{repo}/git/refs/tags/${tag}`])
    }
    existing = null
  }

  if (existing !== null && releaseExists(tag)) {
    console.log(`${tag}: already published at this tree, refreshing notes`)
    withNotes(body, (notes) =>
      ghRun(['release', 'edit', tag, '--title', title, '--notes-file', notes]),
    )
    return
  }

  // An existing tag outlived a run that died before its release was created, so
  // the release attaches to it rather than moving it.
  const targetArg = existing === null ? ['--target', target] : []
  console.log(
    existing === null
      ? `${tag}: creating at ${target.slice(0, 9)}`
      : `${tag}: tag exists without a release, creating from it`,
  )
  withNotes(body, (notes) =>
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
    ]),
  )
}

const releases = knopePackages()
  .map(releaseFor)
  .filter((release) => release !== null)
if (releases.length === 0) {
  throw new Error(`no package at ${ref} needs a ${mode}`)
}
for (const release of releases) publish(release)
console.log(`${releases.length} release(s) at ${target.slice(0, 9)}`)
