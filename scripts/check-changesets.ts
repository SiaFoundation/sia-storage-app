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
  for (const line of frontmatter) {
    const colon = line.indexOf(':')
    if (colon === -1) {
      // Knope fails the whole run on this, including on a blank line.
      problems.push(`"${line.trim()}" is not a "<package>: <bump>" line`)
      continue
    }
    const key = line.slice(0, colon).trim()
    const bump = line.slice(colon + 1).trim()
    if (!packages.includes(key)) {
      problems.push(describeBadKey(key, packages))
    }
    if (!bumps.has(bump)) {
      problems.push(`"${bump}" is not a bump level, use patch, minor, or major`)
    }
  }

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
