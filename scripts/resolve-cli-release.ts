// Decides which release a CLI build belongs to, for release-cli.yml.
//
// The build bakes this version into the binary and the upload attaches to this
// release, so both read one answer and cannot name different releases.
//
// Picking the newest release is the subtle part. `sort -V` orders
// `cli/v0.0.6-rc.1` above `cli/v0.0.6`, the reverse of semver, where a
// prerelease precedes the version it graduates into. Sorting that way would
// resolve a graduated version back to the candidate it graduated from, so the
// comparison here drops candidates and an explicit tag is the way to reach one.

import { appendFileSync } from 'fs'

const CLI_TAG = /^cli\/v(.+)$/

type Release = { tagName: string; isPrerelease: boolean }

function stableCliVersions(releases: Release[]): string[] {
  return releases
    .filter((release) => !release.isPrerelease)
    .map((release) => CLI_TAG.exec(release.tagName)?.[1])
    .filter((version) => version !== undefined)
}

function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split('.').map(Number)
  const [left, right] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function newestStable(): string {
  const listed = Bun.spawnSync([
    'gh',
    'release',
    'list',
    '--limit',
    '100',
    '--json',
    'tagName,isPrerelease',
  ])
  if (!listed.success) {
    throw new Error(`could not list releases: ${listed.stderr.toString()}`)
  }
  const versions = stableCliVersions(JSON.parse(listed.stdout.toString())).sort(compareVersions)
  const newest = versions.at(-1)
  if (!newest) throw new Error('no stable cli/v* release to upload to')
  return `cli/v${newest}`
}

function resolve(): string {
  const eventTag = process.env.EVENT_TAG
  if (eventTag) return eventTag

  const inputTag = process.env.INPUT_TAG
  if (inputTag) return inputTag

  const ref = process.env.REF ?? ''
  if (ref.startsWith('refs/tags/cli/v')) return ref.replace('refs/tags/', '')

  // A build-only dispatch off a branch belongs to no release, so the binary
  // reports the checked-in version instead.
  if (process.env.WANTS_UPLOAD !== 'true') return ''

  return newestStable()
}

const tag = resolve()
console.log(`Resolved release tag: ${tag || '<none, building from the checked-in version>'}`)
const output = process.env.GITHUB_OUTPUT
if (output) appendFileSync(output, `tag=${tag}\n`)
