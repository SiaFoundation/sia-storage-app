import { describe, expect, test } from 'bun:test'
import {
  type AppStoreVersion,
  appStoreReview,
  planAppStore,
  planAppStoreRelease,
  planGooglePlay,
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

  test('is approved once Apple accepts the version', () => {
    const review = appStoreReview(
      [version('1.15.1', 'PENDING_DEVELOPER_RELEASE', 'b2')],
      '1.15.1',
      'b2',
    )
    expect(review).toEqual({ label: 'Approved', status: 'success', approved: true })
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
