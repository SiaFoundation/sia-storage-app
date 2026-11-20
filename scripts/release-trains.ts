/**
 * The release trains. Each app that ships has its own train: its own release
 * PR, versions and tags. An app waiting at a gate, such as App Store review
 * or a beta round, holds back no other app, and merging to main never waits
 * for a release.
 *
 * A gated train cuts release candidates (X.Y.Z-rc.N) on `release/<app>` and
 * graduates one through a final PR on `release/<app>-final`. The packages
 * train has no gate and releases stable versions straight from
 * `release/packages`. RELEASING.md describes the whole flow.
 *
 * Knope versions every package that has a changeset, so each train runs it
 * with the other trains' changesets moved out of the tree. A changeset may
 * therefore name the packages of one train only, which check-changesets.ts
 * enforces.
 */

import {
  type AppName,
  changelogSections,
  collapse,
  marketingVersion,
} from '../apps/mobile/scripts/releaseNotes'

export type TrainName = 'mobile' | 'desktop' | 'packages'

export type Train = {
  name: TrainName
  packages: readonly string[]
  /** The app a gated train releases, or null for a train with no gate. */
  app: AppName | null
}

export const TRAINS: readonly Train[] = [
  { name: 'mobile', packages: ['mobile'], app: 'mobile' },
  { name: 'desktop', packages: ['desktop'], app: 'desktop' },
  { name: 'packages', packages: ['cli', 'core', 'logger', 'web'], app: null },
]

export const GATED: readonly (Train & { app: AppName })[] = TRAINS.flatMap((t) =>
  t.app ? [{ ...t, app: t.app }] : [],
)

export function trainOf(pkg: string): Train | undefined {
  return TRAINS.find((t) => t.packages.includes(pkg))
}

export function trainNamed(name: string): Train {
  const train = TRAINS.find((t) => t.name === name)
  if (!train) throw new Error(`${name} is not a release train`)
  return train
}

/** The one train a changeset's packages belong to, or why they belong to none. */
export function changesetTrain(packages: readonly string[]): Train | string {
  const trains = [...new Set(packages.map((p) => trainOf(p)?.name ?? p))]
  if (trains.length === 1) {
    const train = TRAINS.find((t) => t.name === trains[0])
    if (train) return train
  }
  const named =
    trains.length > 1 ? `${trains.slice(0, -1).join(', ')} and ${trains.at(-1)}` : trains[0]
  return `names packages of the ${named} trains, which release separately. Write one changeset for each`
}

export function candidateBranch(train: TrainName): string {
  return `release/${train}`
}

export function finalBranch(app: AppName): string {
  return `release/${app}-final`
}

/** The train and kind of a release PR's branch, or null for any other branch. */
export function releaseBranch(ref: string): { train: Train; final: boolean } | null {
  const match = /^release\/(\w+?)(-final)?$/.exec(ref)
  const train = match && TRAINS.find((t) => t.name === match[1])
  if (!train || (match[2] && !train.app)) return null
  return { train, final: Boolean(match[2]) }
}

/**
 * Names the candidate a final cut graduates. Committed with the cut, so
 * publish-releases.ts can still find the commit to tag after the rebase that
 * rewrites the release commit onto main.
 */
export function candidateFile(app: AppName): string {
  return `apps/${app}/.release-candidate`
}

export function candidateTag(app: AppName, version: string): string {
  return `${app}/v${version}`
}

const TAG = /^(mobile|desktop)\/v(\d+\.\d+\.\d+-rc\.\d+)$/

/** A candidate tag's app and version, or null for anything else. */
export function parseCandidateTag(tag: string): { app: AppName; version: string } | null {
  const match = TAG.exec(tag.trim())
  return match ? { app: match[1] as AppName, version: match[2] } : null
}

function rcNumber(version: string): number | null {
  const match = /-rc\.(\d+)$/.exec(version)
  return match ? Number(match[1]) : null
}

/**
 * The next candidate of `marketing` after every version in `existing`. While a
 * final PR is open, new candidates keep its version, so a fix made during
 * store review goes to the same App Store version rather than a new one.
 */
export function nextCandidate(marketing: string, existing: readonly string[]): string {
  const numbers = existing
    .filter((v) => marketingVersion(v) === marketing)
    .map(rcNumber)
    .filter((n) => n !== null)
  return `${marketing}-rc.${numbers.length === 0 ? 0 : Math.max(...numbers) + 1}`
}

export type PendingChangeset = { file: string; packages: string[]; text: string }

/** What a candidate shipped: its changeset files and its changelog's entries. */
export type Shipped = { files: Map<string, string[]>; entries: Set<string> }

export function shipped(files: Map<string, string[]>, changelog: string, version: string): Shipped {
  const section = changelogSections(changelog).find((s) => s.version === version)
  return { files, entries: new Set((section?.entries ?? []).map(collapse)) }
}

/**
 * Whether a changeset on main went out in the candidate: its file was in the
 * candidate's tree for this app, or its text is in the candidate's changelog,
 * which covers a changeset split or renamed since.
 */
export function wasShipped(changeset: PendingChangeset, app: AppName, by: Shipped): boolean {
  return by.files.get(changeset.file)?.includes(app) === true || by.entries.has(changeset.text)
}

/**
 * Whether main changed anything an open release PR depends on since the PR
 * was cut: a file its release commit changes, or one of its train's
 * changesets.
 */
export function isStale(changedOnMain: readonly string[], watched: readonly string[]): boolean {
  const watching = new Set(watched)
  return changedOnMain.some((file) => watching.has(file))
}
