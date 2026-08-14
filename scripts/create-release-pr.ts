import { execSync } from 'child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const changelogs = [
  { name: 'core', path: 'packages/core/CHANGELOG.md' },
  { name: 'logger', path: 'packages/logger/CHANGELOG.md' },
  { name: 'mobile', path: 'apps/mobile/CHANGELOG.md' },
  { name: 'web', path: 'apps/web/CHANGELOG.md' },
  { name: 'desktop', path: 'apps/desktop/CHANGELOG.md' },
  { name: 'cli', path: 'apps/cli/CHANGELOG.md' },
]

function getLatestEntry(filePath: string): {
  version: string
  body: string
} | null {
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
  const lines = content.split('\n')
  const start = lines.findIndex((l) => l.startsWith('## '))
  if (start === -1) return null
  const version = lines[start]
    .replace(/^## /, '')
    .replace(/\s*\(.*\)/, '')
    .trim()
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim()
  return body ? { version, body } : null
}

function wasChangedFromMain(filePath: string): boolean {
  try {
    const result = execSync(`git diff main -- "${filePath}"`, {
      encoding: 'utf-8',
    })
    return result.trim().length > 0
  } catch {
    return false
  }
}

// A graduating cut is prepared from the shipped candidate's commit, so anything
// merged after it is held back for the next train. The sections above say what
// ships; without this one, what is being left out is only inferable from which
// changesets survive the merge.
function deferredSummaries(candidate: string): Map<string, string[]> {
  const consumed = new Set(
    execSync(`git diff --diff-filter=D --name-only "${candidate}" HEAD -- .changeset/`, {
      encoding: 'utf-8',
    })
      .split('\n')
      .filter(Boolean),
  )
  const byPackage = new Map<string, string[]>()
  const onMain = execSync('git ls-tree --name-only main .changeset/', { encoding: 'utf-8' })
    .split('\n')
    .filter((path) => path.endsWith('.md'))

  for (const path of onMain) {
    if (consumed.has(path)) continue
    const content = execSync(`git show "main:${path}"`, { encoding: 'utf-8' })
    const frontmatter = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content)
    if (!frontmatter) continue
    const summary = frontmatter[2].trim().split('\n')[0]
    for (const line of frontmatter[1].split('\n')) {
      const name = line.split(':')[0]?.trim()
      if (!name) continue
      byPackage.set(name, [...(byPackage.get(name) ?? []), summary])
    }
  }
  return byPackage
}

function deferredSection(candidate: string): string {
  let byPackage: Map<string, string[]>
  try {
    byPackage = deferredSummaries(candidate)
  } catch (error) {
    // Losing this section costs a reader some context; throwing here would cost
    // them the release PR, which is the only way the cut reaches main.
    console.error(`WARNING: could not list deferred changesets: ${error}`)
    return ''
  }
  if (byPackage.size === 0) return ''
  const packages = [...byPackage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, summaries]) => `**${name}**\n${summaries.map((s) => `- ${s}`).join('\n')}`)
  return `\n\n## Not in this release\n\nMerged after ${candidate} and held for the next train:\n\n${packages.join('\n\n')}`
}

const sections: string[] = []
const versions: string[] = []
for (const { name, path } of changelogs) {
  if (!wasChangedFromMain(path)) continue
  const entry = getLatestEntry(path)
  if (entry) {
    sections.push(`## ${name} ${entry.version}\n\n${entry.body}`)
    versions.push(entry.version)
  }
}

// Versions, not sections: a changelog body may mention "-rc." in prose.
const isRc = versions.some((v) => v.includes('-rc.'))
const final = process.env.RELEASE_MODE === 'final'

const candidate = final ? readFileSync('.release-candidate', 'utf-8').trim() : ''
const note = final
  ? `Merging this PR graduates ${candidate} to a stable release. The tags are created at that candidate's commit, the source that shipped, rather than at main's tip.`
  : isRc
    ? 'Merging this PR will create release candidates: mobile ships to TestFlight and Play internal testing. Run the Finalize Release workflow to cut the stable release.'
    : 'Merging this PR will create a GitHub release.'
const body = `${sections.join('\n\n')}${final ? deferredSection(candidate) : ''}\n\n---\n${note}`

// Every title keeps the "chore: release" prefix the prepare-release skip check
// matches on. The suffix is what publish-releases.ts reads off the merged PR to
// tell a graduation from an ordinary cut, so the two must stay in step.
const title = final ? 'chore: release (final)' : isRc ? 'chore: release (rc)' : 'chore: release'
const bodyFile = join(tmpdir(), 'release-pr-body.md')
writeFileSync(bodyFile, body)

try {
  try {
    execSync(`gh pr create --base main --title "${title}" --body-file "${bodyFile}"`, {
      stdio: 'inherit',
    })
  } catch {
    execSync(`gh pr edit --title "${title}" --body-file "${bodyFile}"`, {
      stdio: 'inherit',
    })
  }
} finally {
  try {
    unlinkSync(bodyFile)
  } catch {}
}
