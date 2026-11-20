// Opens or updates a train's release PR. Called by prepare-release.ts rather
// than run as a knope step, and imported statically there, so the body is
// written by the current code even when the working tree holds an older
// commit's files.

import { execFileSync } from 'child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  APPS,
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
import {
  type Header,
  desktopCandidateHeader,
  desktopFinalHeader,
  mobileCandidateHeader,
  mobileFinalHeader,
  packagesHeader,
  renderHeader,
} from './release-header'
import type { Train } from './release-trains'

const CHANGELOGS: Record<string, string> = {
  core: 'packages/core/CHANGELOG.md',
  logger: 'packages/logger/CHANGELOG.md',
  mobile: 'apps/mobile/CHANGELOG.md',
  web: 'apps/web/CHANGELOG.md',
  desktop: 'apps/desktop/CHANGELOG.md',
  cli: 'apps/cli/CHANGELOG.md',
}

function latestEntry(filePath: string): { version: string; body: string } | null {
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

function changedFromMain(filePath: string): boolean {
  try {
    execFileSync('git', ['diff', '--quiet', 'origin/main', '--', filePath])
    return false
  } catch {
    return true
  }
}

/** Each of the train's packages this cut bumps, with its new changelog entry. */
export function bumped(train: Train): { name: string; version: string; body: string }[] {
  return train.packages.flatMap((name) => {
    const path = CHANGELOGS[name]
    if (!path || !changedFromMain(path)) return []
    const entry = latestEntry(path)
    return entry ? [{ name, ...entry }] : []
  })
}

const STORES: { platform: MobilePlatform; name: string }[] = [
  { platform: 'ios', name: 'App Store' },
  { platform: 'android', name: 'Google Play' },
]

function list(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join('\n')
}

// Mobile shows each store's exact text and its count against the store's
// limit, since that is what review gets. Desktop shows its platforms.
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
  return `## What's New in ${version}\n\n${note}\n\n${body}\n\n`
}

function testingSection(app: AppName, notes: AppTesting): string {
  const platforms = APPS[app].platforms.map((platform) => {
    const candidate = notes.sinceCandidate
      ? `Since ${notes.sinceCandidate.from}:\n\n${list(sinceCandidateLines(notes, platform))}\n\n`
      : ''
    const from = notes.sinceRelease.from ? ` since ${notes.sinceRelease.from}` : ''
    return `### ${PLATFORM_NAMES[platform]}\n\n${candidate}Everything${from}:\n\n${list(sinceReleaseLines(notes, platform))}`
  })
  return `## What to test in ${notes.version}\n\n${platforms.join('\n\n')}\n\n`
}

function candidateNotes(app: AppName, version: string): string {
  const notes = notesFor(readTesting(app), version)
  const marketing = marketingVersion(version)
  const note =
    app === 'mobile'
      ? `Shown in the app, and sent to the stores when ${marketing} is finalized. Change it in \`apps/mobile/release-notes/whats-new.json\` on this branch.`
      : `Shown to users when ${marketing} is finalized. Change it in \`apps/desktop/release-notes/whats-new.json\` on this branch.`
  return `${notes ? testingSection(app, notes) : ''}${whatsNewSection(app, marketing, note)}`
}

function finalNotes(app: AppName, version: string): string {
  const note =
    app === 'mobile'
      ? 'Sent to App Store and Google Play review with the candidate.'
      : 'Shown to users of this version.'
  return whatsNewSection(app, version, note)
}

/** A body section that can't be built must still leave a release PR to fix it in. */
function safely(what: string, build: () => string): string {
  try {
    return build()
  } catch (error) {
    console.error(`WARNING: could not show the ${what}: ${error}`)
    return `> **The ${what} could not be read:** ${error}\n\n`
  }
}

export type ReleasePr =
  | { kind: 'candidate'; train: Train; app: AppName; version: string; inReview: string | null }
  | {
      kind: 'final'
      train: Train
      app: AppName
      version: string
      candidate: string
      buildNumber: string
      appStore: string
      googlePlay: string
      deferred: string[]
    }
  | { kind: 'packages'; train: Train }

function headerOf(pr: ReleasePr, versions: string[]): Header {
  if (pr.kind === 'packages') return packagesHeader(versions)
  if (pr.kind === 'candidate') {
    return pr.app === 'mobile'
      ? mobileCandidateHeader(pr.version, pr.inReview)
      : desktopCandidateHeader(pr.version)
  }
  return pr.app === 'mobile'
    ? mobileFinalHeader({
        version: pr.version,
        candidate: pr.candidate,
        buildNumber: pr.buildNumber,
        appStore: pr.appStore,
        googlePlay: pr.googlePlay,
      })
    : desktopFinalHeader(pr.version, pr.candidate)
}

export function titleOf(pr: ReleasePr, versions: string[]): string {
  // Every title keeps the "chore: release" prefix the prepare-release skip
  // check matches on. "(final)" is one of the two signals publish-releases.ts
  // reads off the merged PR to tell a graduation from an ordinary cut.
  if (pr.kind === 'packages') return `chore: release ${versions.join(', ')}`
  return `chore: release ${pr.app} ${pr.version}${pr.kind === 'final' ? ' (final)' : ''}`
}

/** Opens the warning on a candidate PR whose notes Copilot failed to write, which Prepare Release looks for to try again. */
export const NOTES_NOT_WRITTEN = 'The release notes were not written'

export function releasePrBody(pr: ReleasePr, notesProblem: string | null): string {
  const changes = bumped(pr.train)
  const versions = changes.map((c) => `${c.name} ${c.version}`)
  const warning =
    pr.kind === 'candidate' && notesProblem
      ? `> **${NOTES_NOT_WRITTEN}:** ${notesProblem}\n> Re-run Prepare Release, or write them in \`apps/${pr.app}/release-notes\` on this branch.\n\n`
      : ''
  const notes =
    pr.kind === 'candidate'
      ? safely('release notes', () => candidateNotes(pr.app, pr.version))
      : pr.kind === 'final'
        ? safely('release notes', () => finalNotes(pr.app, pr.version))
        : ''
  const changelogs = changes.map((c) => `## ${c.name} ${c.version}\n\n${c.body}`).join('\n\n')
  const deferred =
    pr.kind === 'final' && pr.deferred.length > 0
      ? `\n\n## Not in this release\n\nMerged after ${pr.candidate}, for the next version:\n\n${list(pr.deferred)}`
      : ''
  return `${renderHeader(headerOf(pr, versions))}\n\n${warning}${notes}${changelogs}${deferred}\n`
}

type OpenPr = { number: number; isDraft: boolean; body: string }

export function openPr(branch: string): OpenPr | null {
  const json = execFileSync(
    'gh',
    ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,isDraft,body'],
    { encoding: 'utf-8' },
  )
  return (JSON.parse(json) as OpenPr[])[0] ?? null
}

/**
 * Opens the branch's PR, or updates the one open. `draft` opens it as a draft,
 * and also turns an open one back into a draft, as when a mobile final is
 * submitted again with a new candidate.
 */
export function publishPr(
  branch: string,
  pr: ReleasePr,
  notesProblem: string | null,
  draft: boolean,
): void {
  const versions = bumped(pr.train).map((c) => `${c.name} ${c.version}`)
  const bodyFile = join(tmpdir(), `release-pr-${branch.replace('/', '-')}.md`)
  writeFileSync(bodyFile, releasePrBody(pr, notesProblem))
  const title = titleOf(pr, versions)
  try {
    const open = openPr(branch)
    if (open) {
      execFileSync(
        'gh',
        ['pr', 'edit', String(open.number), '--title', title, '--body-file', bodyFile],
        {
          stdio: 'inherit',
        },
      )
      if (draft && !open.isDraft) {
        execFileSync('gh', ['pr', 'ready', String(open.number), '--undo'], { stdio: 'inherit' })
      }
    } else {
      execFileSync(
        'gh',
        [
          'pr',
          'create',
          '--base',
          'main',
          '--head',
          branch,
          '--title',
          title,
          '--body-file',
          bodyFile,
          ...(draft ? ['--draft'] : []),
        ],
        { stdio: 'inherit' },
      )
    }
  } finally {
    try {
      unlinkSync(bodyFile)
    } catch {}
  }
}

/** Closes the branch's open PR, when its train has nothing left to release. */
export function closePr(branch: string, reason: string): void {
  const open = openPr(branch)
  if (!open) return
  execFileSync('gh', ['pr', 'close', String(open.number), '--comment', reason], {
    stdio: 'inherit',
  })
}
