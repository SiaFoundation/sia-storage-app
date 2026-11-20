// Validates every .changeset/*.md against what knope will actually accept.
//
// Knope resolves changesets in one direction only: for each package in
// knope.toml it searches the changeset for an entry under that name, and no
// pass ever walks the keys to check they name a real package. An entry keyed by
// a package.json name (`@siastorage/mobile`) or by a package knope.toml doesn't
// declare is therefore unreachable rather than invalid, so it produces no
// warning and no failure. The change ships in the binary, never appears in a
// changelog, and its file survives the release to look merely pending.
//
// The parse below mirrors knope's own (knope-dev/changesets, src/change.rs):
// the first line must be `---`, every line up to the closing `---` splits on
// its first colon, and the key is compared with whitespace trimmed but nothing
// else, so quoting an otherwise valid name breaks the match too.

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { APPS, APP_NAMES, parsePlatforms } from '../apps/mobile/scripts/releaseNotes'
import { changesetTrain, trainOf } from './release-trains'

const bumps = new Set(['patch', 'minor', 'major'])
const kebabFileName = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/

function knopePackages(): string[] {
  const names = [...readFileSync('knope.toml', 'utf-8').matchAll(/^\[packages\.([^\]]+)]/gm)].map(
    (match) => match[1],
  )
  if (names.length === 0) {
    throw new Error('knope.toml declares no [packages.*] entries')
  }
  return names
}

function describeBadKey(key: string, packages: string[]): string {
  const short = key.replace(/^['"]|['"]$/g, '').replace(/^@[^/]+\//, '')
  return packages.includes(short)
    ? `"${key}" is not a knope package, use "${short}"`
    : `"${key}" is not a knope package, expected one of ${packages.join(', ')}`
}

// `platforms:` must name a platform of every app the changeset names, since an
// app left with none would drop the change from its notes altogether.
function platformProblems(value: string, named: string[]): string[] {
  let listed: string[]
  try {
    listed = parsePlatforms(value)
  } catch (error) {
    return [`platforms: ${error instanceof Error ? error.message : error}`]
  }
  const apps = APP_NAMES.filter((app) => named.includes(app))
  if (apps.length === 0) return ['platforms: only mobile and desktop changesets name platforms']
  return apps.flatMap((app) =>
    APPS[app].platforms.some((p) => listed.includes(p))
      ? []
      : [`platforms: names none of ${app}'s platforms, ${APPS[app].platforms.join(', ')}`],
  )
}

function validate(fileName: string, content: string, packages: string[]): string[] {
  const problems: string[] = []
  if (!kebabFileName.test(fileName)) {
    problems.push('file name must be kebab-case')
  }

  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') {
    return [...problems, 'must open with a --- frontmatter line']
  }
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (close === -1) {
    return [...problems, 'frontmatter is never closed with a --- line']
  }

  const frontmatter = lines.slice(1, close)
  if (frontmatter.length === 0) {
    problems.push('frontmatter names no package')
  }
  const named: string[] = []
  let platforms: string | null = null
  for (const line of frontmatter) {
    const colon = line.indexOf(':')
    if (colon === -1) {
      // Knope fails the whole run on this, including on a blank line.
      problems.push(`"${line.trim()}" is not a "<package>: <bump>" line`)
      continue
    }
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    // Knope looks up only its package names, so it skips this line. The
    // release notes read it to keep a change to the platforms it names.
    if (key === 'platforms') {
      platforms = value
      continue
    }
    named.push(key)
    if (!packages.includes(key)) {
      problems.push(describeBadKey(key, packages))
    }
    if (!bumps.has(value)) {
      problems.push(`"${value}" is not a bump level, use patch, minor, or major`)
    }
  }
  if (platforms !== null) problems.push(...platformProblems(platforms, named))
  // Each train runs knope with only its own changesets in the tree, and a
  // stable release deletes the files it consumes, so a changeset naming two
  // trains would vanish from the train that releases second.
  const known = named.filter((name) => packages.includes(name))
  const train = known.length > 0 ? changesetTrain(known) : null
  if (typeof train === 'string') problems.push(train)

  const summary = lines
    .slice(close + 1)
    .join('\n')
    .trim()
  if (summary === '') {
    problems.push('has no description')
  }
  return problems
}

let fileNames: string[]
try {
  fileNames = readdirSync('.changeset')
    .filter((file) => file.endsWith('.md'))
    .sort()
} catch {
  fileNames = []
}

const packages = knopePackages()
const untrained = packages.filter((name) => !trainOf(name))
if (untrained.length > 0) {
  console.error(
    `knope.toml declares ${untrained.join(', ')}, which no release train in scripts/release-trains.ts releases`,
  )
  process.exit(1)
}
let failed = 0
for (const fileName of fileNames) {
  const problems = validate(fileName, readFileSync(join('.changeset', fileName), 'utf-8'), packages)
  if (problems.length === 0) continue
  failed += 1
  for (const problem of problems) {
    console.error(`.changeset/${fileName}: ${problem}`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${fileNames.length} changesets are invalid`)
  process.exit(1)
}
console.log(`${fileNames.length} changesets ok`)
