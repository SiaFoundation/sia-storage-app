import { execSync } from 'child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  APPS,
  APP_NAMES,
  type AppName,
  type AppTesting,
  type MobilePlatform,
  PLATFORM_NAMES,
  type WhatsNewEntry,
  marketingVersion,
  notesFor,
  readTesting,
  readWhatsNew,
  sinceCandidateLines,
  sinceReleaseLines,
  storeLimit,
  storeText,
  whatsNewLines,
} from '../apps/mobile/scripts/releaseNotes'

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

const STORES: { platform: MobilePlatform; name: string }[] = [
  { platform: 'ios', name: 'App Store' },
  { platform: 'android', name: 'Google Play' },
]

function versionOf(app: AppName, ref?: string): string {
  const file = `apps/${app}/package.json`
  const json = ref
    ? execSync(`git show "${ref}:${file}"`, { encoding: 'utf-8' })
    : readFileSync(file, 'utf-8')
  return JSON.parse(json).version
}

function list(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join('\n')
}

// Mobile shows each store's exact text and its count against the store's
// limit, since that is what review gets. Other apps show their platforms.
function whatsNewBody(app: AppName, entry: WhatsNewEntry): string {
  if (app === 'mobile') {
    return STORES.map(({ platform, name }) => {
      const text = storeText(entry, platform)
      return `**${name}** (${text.length} of ${storeLimit(platform)} characters)\n\n${text}`
    }).join('\n\n')
  }
  return APPS[app].platforms
    .map((platform) => `### ${PLATFORM_NAMES[platform]}\n\n${list(whatsNewLines(entry, platform))}`)
    .join('\n\n')
}

function whatsNewSection(app: AppName, version: string, note: string): string {
  const entry = readWhatsNew(app).find((e) => e.version === version)
  const file = `apps/${app}/release-notes/whats-new.json`
  const body = entry ? whatsNewBody(app, entry) : `No entry for ${version} in \`${file}\`.`
  return `## What's New in ${app} ${version}\n\n${note} Change it in \`${file}\` on the release branch.\n\n${body}\n\n`
}

function testingSection(app: AppName, notes: AppTesting): string {
  const platforms = APPS[app].platforms.map((platform) => {
    const candidate = notes.sinceCandidate
      ? `Since ${notes.sinceCandidate.from}:\n\n${list(sinceCandidateLines(notes, platform))}\n\n`
      : ''
    const from = notes.sinceRelease.from ? ` since ${notes.sinceRelease.from}` : ''
    return `### ${PLATFORM_NAMES[platform]}\n\n${candidate}Everything${from}:\n\n${list(sinceReleaseLines(notes, platform))}`
  })
  return `## What to test in ${app} ${notes.version}\n\n${platforms.join('\n\n')}\n\n`
}

// The notes from each app's release-notes folder, which prepare-release.ts
// writes into this same commit. Shown above the changelogs so a reviewer reads
// the text testers, the stores and the apps' users will get.
function notesSection(candidate: string, problem: string | null): string {
  const warning = problem
    ? `> **The release notes were not written:** ${problem}\n> Re-run Prepare Release, or write them in the apps' \`release-notes\` folders on the release branch.\n\n`
    : ''
  const apps = APP_NAMES.filter((app) => wasChangedFromMain(join(APPS[app].dir, 'CHANGELOG.md')))
  if (candidate) {
    const sections = apps.map((app) => {
      const version = versionOf(app)
      const note =
        app === 'mobile'
          ? `Merging this PR submits the ${versionOf(app, candidate)} build to App Store and Google Play review with this text.`
          : 'Shown to users of this version.'
      return whatsNewSection(app, version, note)
    })
    return `${warning}${sections.join('')}`
  }
  const testing = readTesting()
  const sections = apps.map((app) => {
    const version = versionOf(app)
    const notes = notesFor(testing, app, version)
    const marketing = marketingVersion(version)
    const note =
      app === 'mobile'
        ? `Shown in the app, and sent to the stores when ${marketing} is finalized.`
        : `Shown to users when ${marketing} is finalized.`
    return `${notes ? testingSection(app, notes) : ''}${whatsNewSection(app, marketing, note)}`
  })
  return `${warning}${sections.join('')}`
}

// A notes file CI would reject must still leave a release PR to fix it in.
function safeNotesSection(candidate: string, problem: string | null): string {
  try {
    return notesSection(candidate, problem)
  } catch (error) {
    console.error(`WARNING: could not show the release notes: ${error}`)
    return `> **The release notes could not be read:** ${error}\n\n`
  }
}

// Called by prepare-release.ts rather than run as a knope step. Finalizing
// checks out the shipped candidate, replacing the working tree with that
// commit's, so anything knope spawns afterwards executes months-old code. This
// describes the current process rather than the released content, so it has to
// be the current version: a static import is resolved before that checkout and
// runs from memory.
export function createReleasePr(candidate: string, notesProblem: string | null): void {
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
  const final = candidate !== ''
  const note = final
    ? `Merging this PR graduates ${candidate} to a stable release. The tags are created at that candidate's commit, the source that shipped, rather than at main's tip. A mobile tag submits that candidate's build to App Store and Google Play review, and a desktop tag builds the release app and attaches its disk image.`
    : isRc
      ? 'Merging this PR will create release candidates: mobile ships to TestFlight and Play internal testing, and desktop attaches a notarized beta disk image to its prerelease. Run the Finalize Release workflow to cut the stable release.'
      : 'Merging this PR will create a GitHub release.'
  const body = `${safeNotesSection(candidate, notesProblem)}${sections.join('\n\n')}${final ? deferredSection(candidate) : ''}\n\n---\n${note}`

  // Every title keeps the "chore: release" prefix the prepare-release skip check
  // matches on. The suffix is one of the two signals publish-releases.ts reads off
  // the merged PR to tell a graduation from an ordinary cut.
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
}
