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
  | { kind: 'replace'; versionId: string }
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

// Waiting for review or in review. A version here can be removed from review
// and given another build, which is how a fixed candidate replaces one.
const REVIEWING = new Set(['WAITING_FOR_REVIEW', 'IN_REVIEW'])

const APPROVED = new Set(['ACCEPTED', 'PENDING_DEVELOPER_RELEASE', 'PENDING_APPLE_RELEASE'])

// Released, or being released. A version here is on sale or about to be, and
// Apple takes no other build for it.
const RELEASED = new Set([...LIVE, 'PROCESSING_FOR_DISTRIBUTION', 'PENDING_APPLE_RELEASE'])

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
    if (target.buildId === buildId || target.buildId === null) {
      return { kind: 'done', reason: `${versionString} is already ${target.state}` }
    }
    if (REVIEWING.has(target.state)) return { kind: 'replace', versionId: target.id }
    // After the other store rejected the version, its fix goes to that store
    // alone: users here already have the version, with an earlier build.
    if (RELEASED.has(target.state)) {
      return {
        kind: 'done',
        reason: `${versionString} is already released with an earlier candidate's build, which stays`,
      }
    }
    return {
      kind: 'blocked',
      reason: APPROVED.has(target.state)
        ? `${versionString} is approved and held for release with another build, and the API can't change it. Reject that build in App Store Connect, then run this again`
        : `${versionString} is ${target.state} with another build`,
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

/** Where a store has a version in review, for a final PR's header and status. */
export type StoreReview = {
  label: string
  status: 'pending' | 'success' | 'failure'
  /** The store approved the build. */
  approved: boolean
  /** The build is out to the store's users, or on its way out. */
  live: boolean
}

const REVIEW_LABELS: Record<string, Omit<StoreReview, 'approved' | 'live'>> = {
  PREPARE_FOR_SUBMISSION: { label: 'Not submitted yet', status: 'pending' },
  READY_FOR_REVIEW: { label: 'Not submitted yet', status: 'pending' },
  WAITING_FOR_EXPORT_COMPLIANCE: { label: 'Waiting for export compliance', status: 'pending' },
  WAITING_FOR_REVIEW: { label: 'Waiting for review', status: 'pending' },
  IN_REVIEW: { label: 'In review', status: 'pending' },
  REJECTED: { label: 'Rejected, see App Store Connect', status: 'failure' },
  METADATA_REJECTED: {
    label: 'Listing rejected. Fix it and resubmit in App Store Connect',
    status: 'failure',
  },
  DEVELOPER_REJECTED: { label: 'Removed from review', status: 'failure' },
  INVALID_BINARY: { label: 'Build rejected as invalid', status: 'failure' },
}

/**
 * The review state of `versionString` with `buildId`. Only the state's name is
 * read, so nothing a reviewer wrote reaches the public PR. A version set to
 * manual release in App Store Connect is approved but not live until someone
 * releases it, there or by merging the final PR.
 */
export function appStoreReview(
  versions: AppStoreVersion[],
  versionString: string,
  buildId: string,
): StoreReview {
  const no = { approved: false, live: false }
  const target = versions.find((v) => v.versionString === versionString)
  if (!target) {
    return { label: 'Not on the App Store. Run Finalize Release', status: 'failure', ...no }
  }
  const released = RELEASED.has(target.state)
  if (target.buildId !== null && target.buildId !== buildId) {
    return released
      ? {
          label: "Released with an earlier candidate's build",
          status: 'success',
          approved: true,
          live: true,
        }
      : {
          label: 'Has another build. Run Finalize Release for this candidate',
          status: 'failure',
          ...no,
        }
  }
  if (released) return { label: 'Released', status: 'success', approved: true, live: true }
  if (APPROVED.has(target.state)) {
    return {
      label: 'Approved and held for release. Release it in App Store Connect, or merge this PR',
      status: 'success',
      approved: true,
      live: false,
    }
  }
  const known = REVIEW_LABELS[target.state]
  return known
    ? { ...known, ...no }
    : { label: `In state ${target.state}`, status: 'pending', ...no }
}

export type AppStoreReleasePlan =
  | { kind: 'release'; versionId: string }
  | { kind: 'done'; reason: string }
  | { kind: 'blocked'; reason: string }

/** Releasing an approved version, which is set to wait for a manual release. */
export function planAppStoreRelease(
  versions: AppStoreVersion[],
  versionString: string,
  buildId: string,
): AppStoreReleasePlan {
  const target = versions.find((v) => v.versionString === versionString)
  if (!target) return { kind: 'blocked', reason: `the App Store has no ${versionString}` }
  // Checked before the build: a version Apple released with an earlier
  // candidate's build, before the other store rejected it, stays that way.
  if (RELEASED.has(target.state)) {
    return { kind: 'done', reason: `${versionString} is already ${target.state}` }
  }
  if (target.buildId !== buildId) {
    return { kind: 'blocked', reason: `${versionString} has another build than the candidate's` }
  }
  if (target.state === 'PENDING_DEVELOPER_RELEASE') {
    return { kind: 'release', versionId: target.id }
  }
  return { kind: 'blocked', reason: `${versionString} is ${target.state}, not approved yet` }
}

/** A release on a Play track, as `tracks.releases.list` reports it. */
export type PlayReleaseSummary = {
  releaseName?: string
  activeArtifacts?: { versionCode?: number }[]
  releaseLifecycleState?: string
}

const PLAY_LABELS: Record<string, Omit<StoreReview, 'approved' | 'live'>> = {
  RELEASE_LIFECYCLE_STATE_DRAFT: { label: 'Draft, not sent for review', status: 'pending' },
  RELEASE_LIFECYCLE_STATE_NOT_SENT_FOR_REVIEW: { label: 'Not sent for review', status: 'pending' },
  RELEASE_LIFECYCLE_STATE_IN_REVIEW: { label: 'In review', status: 'pending' },
  RELEASE_LIFECYCLE_STATE_NOT_APPROVED: { label: 'Rejected, see Play Console', status: 'failure' },
}

/**
 * The review state of the production release holding `versionCode`. With
 * managed publishing on, an approved release waits for someone to publish it
 * in Play Console, since the API has no call that publishes it.
 */
export function playReview(releases: PlayReleaseSummary[], versionCode: string): StoreReview {
  const no = { approved: false, live: false }
  const release = releases.find((r) =>
    (r.activeArtifacts ?? []).some((a) => String(a.versionCode) === versionCode),
  )
  if (!release) {
    return { label: 'Not on the production track. Run Finalize Release', status: 'failure', ...no }
  }
  const state = release.releaseLifecycleState ?? 'RELEASE_LIFECYCLE_STATE_UNSPECIFIED'
  if (state === 'RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED') {
    return {
      label: 'Approved and held by managed publishing. Publish it in Play Console',
      status: 'success',
      approved: true,
      live: false,
    }
  }
  if (state === 'RELEASE_LIFECYCLE_STATE_PUBLISHED') {
    return { label: 'Published', status: 'success', approved: true, live: true }
  }
  const known = PLAY_LABELS[state]
  return known
    ? { ...known, ...no }
    : {
        label: `In state ${state.replace('RELEASE_LIFECYCLE_STATE_', '')}`,
        status: 'pending',
        ...no,
      }
}

/**
 * Whether production already published `version` with another build, as when
 * Google approved it before the App Store rejected it. Its users then get the
 * fix as an update of a version they have, so its notes are generic.
 */
export function playAlreadyLive(
  releases: PlayReleaseSummary[],
  version: string,
  versionCode: string,
): boolean {
  return releases.some(
    (r) =>
      r.releaseName === version &&
      r.releaseLifecycleState === 'RELEASE_LIFECYCLE_STATE_PUBLISHED' &&
      !(r.activeArtifacts ?? []).some((a) => String(a.versionCode) === versionCode),
  )
}
