// Runs knope prepare-release in the right mode: rc when a pending changeset
// touches an rc-gated package, stable when none do, and final when
// RELEASE_MODE=final (the Finalize Release workflow) graduates a shipped
// candidate.
//
// Knope's prerelease label applies to every package in a run, so packages
// without a gate ride an rc train along and graduate with the final cut. Knope
// retains change files across rc runs; that is what keeps the train pending,
// and it is why the last rc's changelog entry already lists everything the cut
// contains.

import { execFileSync, execSync } from 'child_process'
import { readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createReleasePr } from './create-release-pr'

// Records which candidate a final cut graduated. It is committed with the cut,
// so scripts/publish-releases.ts can still find the commit to tag after the
// rebase that rewrites the release commit onto main.
const CANDIDATE_FILE = '.release-candidate'

// Packages whose releases pass through an external gate between cut and ship
// (store review, manual promotion), so their trains need the rc cycle.
const rcPackages = [{ name: 'mobile', packageJson: 'apps/mobile/package.json' }]

const rcKeyPattern = new RegExp(`^(${rcPackages.map((p) => p.name).join('|')})\\s*:`, 'm')

function pendingChangesetsTouchRcPackage(): boolean {
  let files: string[]
  try {
    files = readdirSync('.changeset').filter((f) => f.endsWith('.md'))
  } catch {
    return false
  }
  return files.some((file) => {
    const content = readFileSync(join('.changeset', file), 'utf-8')
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content)
    return frontmatter !== null && rcKeyPattern.test(frontmatter[1])
  })
}

// A final cut is prepared from a commit main has already moved past, so
// regenerating the release branch from main HEAD while one is open would
// silently replace it with an rc and lose the graduation. Skipping instead of
// failing keeps an ordinary merge to main from going red; the next push after
// the final merges starts the following train.
function finalCutIsOpen(): boolean {
  try {
    const open = execFileSync(
      'gh',
      [
        'pr',
        'list',
        '--head',
        'release',
        '--state',
        'open',
        '--json',
        'title',
        '--jq',
        '.[].title',
      ],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return open.includes('(final)')
  } catch (error) {
    // Proceeding is the recoverable direction: a clobbered graduation is fixed
    // by re-running Finalize, whereas treating an unreadable list as "a final
    // cut is open" would stall every train until someone noticed. Say so
    // loudly, since a guard that quietly stops guarding is the worse failure.
    console.error(`WARNING: could not check for an open final cut, continuing anyway: ${error}`)
    return false
  }
}

// Finalizing runs from the shipped candidate's tagged commit, not main HEAD:
// changesets merged after that candidate must not graduate with it, and at the
// tag they do not exist yet, so they stay on main and start the next train.
// SHIPPED_CANDIDATE overrides the inference for the case where a newer candidate
// was cut after the one that shipped. Otherwise the current package.json version
// names the latest cut candidate; every rc tag of a train points at the same
// release commit, so the first rc-versioned package works for all of them.
function checkoutShippedCandidate(): string {
  const explicit = process.env.SHIPPED_CANDIDATE
  if (explicit) return checkout(explicit)
  for (const { name, packageJson } of rcPackages) {
    const { version } = JSON.parse(readFileSync(packageJson, 'utf-8'))
    if (!version.includes('-rc.')) continue
    return checkout(`${name}/v${version}`)
  }
  // Reached when main carries no rc version, which is what main looks like once
  // a final cut has merged. Inferring from main HEAD there would prepare a cut
  // from the wrong commit, so the candidate has to be named explicitly.
  throw new Error(
    'no rc version on main to infer the shipped candidate from; re-run with the candidate input set',
  )
}

function checkout(candidate: string): string {
  console.log(`finalizing from the shipped candidate ${candidate}`)
  execFileSync('git', ['checkout', candidate], { stdio: 'inherit' })
  return candidate
}

const final = process.env.RELEASE_MODE === 'final'
if (!final && finalCutIsOpen()) {
  console.log('a final cut is open; leaving the release branch alone until it merges or closes')
  process.exit(0)
}

const candidate = final ? checkoutShippedCandidate() : ''
if (final) {
  writeFileSync(CANDIDATE_FILE, `${candidate}\n`)
}

const rc = !final && pendingChangesetsTouchRcPackage()
console.log(
  rc ? 'rc-gated changes pending: preparing a release candidate' : 'preparing a final release',
)
execSync(`knope prepare-release --verbose${rc ? ' --prerelease-label rc' : ''}`, {
  stdio: 'inherit',
})

// Not a knope step: knope spawns those after the working tree has been replaced
// by the candidate's, which would run whatever version of this shipped back
// then. Imported statically instead, so it is resolved before that checkout.
createReleasePr(final ? candidate : '')
