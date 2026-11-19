/**
 * What a store submission run does, decided from what the store already holds,
 * so that re-running a failed or finished run is always safe.
 */

/** An App Store version, with the state App Store Connect reports for it. */
export type AppStoreVersion = {
  id: string
  versionString: string
  state: string
  buildId: string | null
}

export type AppStorePlan =
  | { kind: 'create' }
  | { kind: 'update'; versionId: string }
  | { kind: 'done'; reason: string }
  | { kind: 'blocked'; reason: string }

// Submitted, approved or live. Nothing is left to do for the version.
const SUBMITTED = new Set([
  'WAITING_FOR_REVIEW',
  'IN_REVIEW',
  'ACCEPTED',
  'PENDING_DEVELOPER_RELEASE',
  'PENDING_APPLE_RELEASE',
  'PROCESSING_FOR_DISTRIBUTION',
  'READY_FOR_DISTRIBUTION',
  'READY_FOR_SALE',
  'REPLACED_WITH_NEW_VERSION',
])

// A version in one of these takes a build and notes and can be submitted. A
// rejected version comes back here after the problem is fixed, so a re-run
// resubmits it.
const EDITABLE = new Set([
  'PREPARE_FOR_SUBMISSION',
  'READY_FOR_REVIEW',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
])

const LIVE = new Set(['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE', 'REPLACED_WITH_NEW_VERSION'])

// Apple allows one version in progress at a time, so an older one that is not
// yet live keeps a new one from being created or submitted.
const IN_PROGRESS = new Set([...EDITABLE, ...SUBMITTED].filter((s) => !LIVE.has(s)))

function newer(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

export function planAppStore(
  versions: AppStoreVersion[],
  versionString: string,
  buildId: string,
): AppStorePlan {
  const target = versions.find((v) => v.versionString === versionString)
  if (target && SUBMITTED.has(target.state)) {
    return target.buildId === buildId || target.buildId === null
      ? { kind: 'done', reason: `${versionString} is already ${target.state}` }
      : {
          kind: 'blocked',
          reason: `${versionString} is ${target.state} with another build`,
        }
  }
  const later = versions.find((v) => newer(v.versionString, versionString))
  if (later) {
    return { kind: 'blocked', reason: `the App Store already has a newer ${later.versionString}` }
  }
  const other = versions.find((v) => v.versionString !== versionString && IN_PROGRESS.has(v.state))
  if (other) {
    return {
      kind: 'blocked',
      reason: `${other.versionString} is still ${other.state}. Release or remove it first, since the App Store takes one version at a time`,
    }
  }
  if (!target) return { kind: 'create' }
  if (EDITABLE.has(target.state)) return { kind: 'update', versionId: target.id }
  return {
    kind: 'blocked',
    reason: `${versionString} is ${target.state}, which this run cannot change`,
  }
}

/** A release on the Play production track. */
export type PlayRelease = { name?: string; versionCodes?: string[]; status: string }

export type PlayPlan =
  | { kind: 'release' }
  | { kind: 'done'; reason: string }
  | { kind: 'blocked'; reason: string }

export function planGooglePlay(releases: PlayRelease[], versionCode: string): PlayPlan {
  const codes = releases.flatMap((r) => (r.status === 'draft' ? [] : (r.versionCodes ?? [])))
  if (codes.includes(versionCode)) {
    return { kind: 'done', reason: `production already has version code ${versionCode}` }
  }
  const later = codes.find((c) => Number(c) > Number(versionCode))
  if (later) {
    return { kind: 'blocked', reason: `production already has a newer version code ${later}` }
  }
  return { kind: 'release' }
}
