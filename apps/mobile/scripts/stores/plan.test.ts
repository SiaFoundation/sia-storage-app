import { describe, expect, test } from 'bun:test'
import {
  type AppStoreVersion,
  appStoreReview,
  planAppStore,
  planAppStoreRelease,
  planGooglePlay,
  playAlreadyLive,
  playReview,
} from './plan'
import { requestShape } from './appStore'

const version = (versionString: string, state: string, buildId: string | null = null) =>
  ({ id: `v-${versionString}`, versionString, state, buildId }) satisfies AppStoreVersion

describe('an App Store submission run', () => {
  const live = version('1.15.0', 'READY_FOR_DISTRIBUTION', 'b1')

  test('creates the version when only older live versions exist', () => {
    expect(planAppStore([live], '1.15.1', 'b2')).toEqual({ kind: 'create' })
  })

  test('updates a version an earlier run created but did not submit', () => {
    const prepared = version('1.15.1', 'PREPARE_FOR_SUBMISSION')
    expect(planAppStore([live, prepared], '1.15.1', 'b2')).toEqual({
      kind: 'update',
      versionId: 'v-1.15.1',
    })
  })

  test('resubmits a rejected version', () => {
    const rejected = version('1.15.1', 'REJECTED', 'b2')
    expect(planAppStore([rejected], '1.15.1', 'b2').kind).toBe('update')
  })

  test('does nothing when the version is in review or approved with this build', () => {
    for (const state of ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE']) {
      expect(planAppStore([version('1.15.1', state, 'b2')], '1.15.1', 'b2').kind).toBe('done')
    }
  })

  test('replaces the build of a version waiting for review or in review', () => {
    for (const state of ['WAITING_FOR_REVIEW', 'IN_REVIEW']) {
      expect(planAppStore([version('1.15.1', state, 'b9')], '1.15.1', 'b2')).toEqual({
        kind: 'replace',
        versionId: 'v-1.15.1',
      })
    }
  })

  test('stops when the version is approved with another build', () => {
    const plan = planAppStore(
      [version('1.15.1', 'PENDING_DEVELOPER_RELEASE', 'b9')],
      '1.15.1',
      'b2',
    )
    expect(plan.kind).toBe('blocked')
    expect(plan.kind === 'blocked' && plan.reason).toContain(
      'Reject that build in App Store Connect',
    )
  })

  test('stops while an older version waits for review or to be released', () => {
    const waiting = version('1.15.0', 'PENDING_DEVELOPER_RELEASE', 'b1')
    expect(planAppStore([waiting], '1.15.1', 'b2').kind).toBe('blocked')
  })

  test('stops when a newer version exists', () => {
    expect(planAppStore([version('1.16.0', 'READY_FOR_DISTRIBUTION')], '1.15.1', 'b2')).toEqual({
      kind: 'blocked',
      reason: 'the App Store already has a newer 1.16.0',
    })
  })
})

describe('a Google Play submission run', () => {
  test('releases when production has an older build', () => {
    expect(planGooglePlay([{ status: 'completed', versionCodes: ['1150099'] }], '1150103')).toEqual(
      { kind: 'release' },
    )
  })

  test('does nothing when production already has this build', () => {
    expect(
      planGooglePlay([{ status: 'completed', versionCodes: ['1150103'] }], '1150103').kind,
    ).toBe('done')
  })

  test('replaces a draft that holds this build', () => {
    expect(planGooglePlay([{ status: 'draft', versionCodes: ['1150103'] }], '1150103').kind).toBe(
      'release',
    )
  })

  test('stops when production has a newer build', () => {
    expect(
      planGooglePlay([{ status: 'completed', versionCodes: ['1160000'] }], '1150103').kind,
    ).toBe('blocked')
  })
})

describe('an App Store review state', () => {
  test('is pending while the version waits for review or is in review', () => {
    expect(appStoreReview([version('1.15.1', 'WAITING_FOR_REVIEW', 'b2')], '1.15.1', 'b2')).toEqual(
      {
        label: 'Waiting for review',
        status: 'pending',
        approved: false,
        live: false,
      },
    )
    expect(appStoreReview([version('1.15.1', 'IN_REVIEW', 'b2')], '1.15.1', 'b2').label).toBe(
      'In review',
    )
  })

  test('fails when review rejects the version', () => {
    const review = appStoreReview([version('1.15.1', 'REJECTED', 'b2')], '1.15.1', 'b2')
    expect(review.status).toBe('failure')
    expect(review.approved).toBe(false)
  })

  test('is approved but not live while the version is held for a manual release', () => {
    const review = appStoreReview(
      [version('1.15.1', 'PENDING_DEVELOPER_RELEASE', 'b2')],
      '1.15.1',
      'b2',
    )
    expect(review).toMatchObject({ status: 'success', approved: true, live: false })
    expect(review.label).toContain('Release it in App Store Connect')
  })

  test('is live once Apple releases the version', () => {
    expect(
      appStoreReview([version('1.15.1', 'READY_FOR_DISTRIBUTION', 'b2')], '1.15.1', 'b2'),
    ).toEqual({ label: 'Released', status: 'success', approved: true, live: true })
  })

  test("fails when the version carries another candidate's build", () => {
    expect(appStoreReview([version('1.15.1', 'IN_REVIEW', 'b9')], '1.15.1', 'b2').status).toBe(
      'failure',
    )
  })

  test('names a state it does not know without failing', () => {
    expect(appStoreReview([version('1.15.1', 'SOMETHING_NEW', 'b2')], '1.15.1', 'b2')).toEqual({
      label: 'In state SOMETHING_NEW',
      status: 'pending',
      approved: false,
      live: false,
    })
  })
})

describe('releasing an approved App Store version', () => {
  test('releases a version waiting for its manual release', () => {
    expect(
      planAppStoreRelease([version('1.15.1', 'PENDING_DEVELOPER_RELEASE', 'b2')], '1.15.1', 'b2'),
    ).toEqual({ kind: 'release', versionId: 'v-1.15.1' })
  })

  test('does nothing for a version already released', () => {
    expect(
      planAppStoreRelease([version('1.15.1', 'READY_FOR_DISTRIBUTION', 'b2')], '1.15.1', 'b2').kind,
    ).toBe('done')
  })

  test('stops for a version still in review or with another build', () => {
    expect(planAppStoreRelease([version('1.15.1', 'IN_REVIEW', 'b2')], '1.15.1', 'b2').kind).toBe(
      'blocked',
    )
    expect(
      planAppStoreRelease([version('1.15.1', 'PENDING_DEVELOPER_RELEASE', 'b9')], '1.15.1', 'b2')
        .kind,
    ).toBe('blocked')
  })
})

describe('an App Store request named in an error', () => {
  test('keeps the resource kinds and drops every id and the query', () => {
    expect(
      requestShape('PATCH', '/v1/appStoreVersions/8a3f-21c/appStoreVersionLocalizations'),
    ).toBe('PATCH /v1/appStoreVersions/{id}/appStoreVersionLocalizations')
    expect(requestShape('GET', '/v1/builds?filter[app]=1234567890&filter[version]=1150103')).toBe(
      'GET /v1/builds',
    )
    expect(requestShape('GET', '/v1/apps/1234567890/appStoreVersions?limit=50')).toBe(
      'GET /v1/apps/{id}/appStoreVersions',
    )
  })
})

describe('a Google Play review state', () => {
  const release = (state: string, versionCode = 1150103) => ({
    releaseName: '1.15.1',
    activeArtifacts: [{ versionCode }],
    releaseLifecycleState: `RELEASE_LIFECYCLE_STATE_${state}`,
  })

  test('is pending while the release is in review', () => {
    expect(playReview([release('IN_REVIEW')], '1150103')).toEqual({
      label: 'In review',
      status: 'pending',
      approved: false,
      live: false,
    })
  })

  test('is approved but not live while managed publishing holds the release', () => {
    expect(playReview([release('APPROVED_NOT_PUBLISHED')], '1150103')).toEqual({
      label: 'Approved and held by managed publishing. Publish it in Play Console',
      status: 'success',
      approved: true,
      live: false,
    })
  })

  test('is live once the release is published', () => {
    expect(playReview([release('PUBLISHED')], '1150103')).toMatchObject({
      approved: true,
      live: true,
    })
  })

  test('fails when review rejects the release', () => {
    expect(playReview([release('NOT_APPROVED')], '1150103').status).toBe('failure')
  })

  test("fails when production has no release with the candidate's build", () => {
    expect(playReview([release('IN_REVIEW', 1150104)], '1150103').status).toBe('failure')
  })
})

describe('a version one store released before the other approved it', () => {
  test('stays on the App Store with its build when a later candidate is submitted', () => {
    const live = version('1.15.1', 'READY_FOR_DISTRIBUTION', 'b3')
    expect(planAppStore([live], '1.15.1', 'b4')).toEqual({
      kind: 'done',
      reason: "1.15.1 is already released with an earlier candidate's build, which stays",
    })
    expect(planAppStoreRelease([live], '1.15.1', 'b4')).toEqual({
      kind: 'done',
      reason: '1.15.1 is already READY_FOR_DISTRIBUTION',
    })
    expect(appStoreReview([live], '1.15.1', 'b4')).toEqual({
      label: "Released with an earlier candidate's build",
      status: 'success',
      approved: true,
      live: true,
    })
  })

  test('is live on Google Play when production published it with another build', () => {
    const published = {
      releaseName: '1.15.1',
      activeArtifacts: [{ versionCode: 1150103 }],
      releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_PUBLISHED',
    }
    expect(playAlreadyLive([published], '1.15.1', '1150104')).toBe(true)
    expect(playAlreadyLive([published], '1.15.1', '1150103')).toBe(false)
    expect(playAlreadyLive([published], '1.15.2', '1150200')).toBe(false)
    const inReview = { ...published, releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_IN_REVIEW' }
    expect(playAlreadyLive([inReview], '1.15.1', '1150104')).toBe(false)
  })
})
