// Runs knope prepare-release in the right mode: rc when a pending changeset
// touches an rc-gated package, final when none do or when RELEASE_MODE=final (the
// Finalize Release workflow) graduates the train.
//
// Knope's prerelease label applies to every package in a run, so packages without
// a gate ride an rc train along and graduate with the final cut. Knope retains
// change files across rc runs; that is what keeps the train pending.

import { execSync } from 'child_process'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

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

// Finalizing runs from the shipped candidate's tagged commit, not main HEAD:
// changesets merged after that candidate must not graduate with it, and at the
// tag they do not exist yet, so they stay on main and start the next train.
// SHIPPED_CANDIDATE overrides the inference for the case where a newer candidate
// was cut after the one that shipped. Otherwise the current package.json version
// names the latest cut candidate; every rc tag of a train points at the same
// release commit, so the first rc-versioned package works for all of them.
function checkoutShippedCandidate() {
  const explicit = process.env.SHIPPED_CANDIDATE
  if (explicit) {
    console.log(`finalizing from the shipped candidate ${explicit}`)
    execSync(`git checkout "${explicit}"`, { stdio: 'inherit' })
    return
  }
  for (const { name, packageJson } of rcPackages) {
    const { version } = JSON.parse(readFileSync(packageJson, 'utf-8'))
    if (!version.includes('-rc.')) continue
    console.log(`finalizing from the shipped candidate ${name}/v${version}`)
    execSync(`git checkout "${name}/v${version}"`, { stdio: 'inherit' })
    return
  }
}

const final = process.env.RELEASE_MODE === 'final'
const rc = !final && pendingChangesetsTouchRcPackage()
if (final) checkoutShippedCandidate()
console.log(
  rc ? 'rc-gated changes pending: preparing a release candidate' : 'preparing a final release',
)
execSync(`knope prepare-release --verbose${rc ? ' --prerelease-label rc' : ''}`, {
  stdio: 'inherit',
})
