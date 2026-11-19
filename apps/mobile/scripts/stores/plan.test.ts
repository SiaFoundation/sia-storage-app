import { describe, expect, test } from 'bun:test'
import { type AppStoreVersion, planAppStore, planGooglePlay } from './plan'

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

  test('stops when the version is in review with another build', () => {
    const plan = planAppStore([version('1.15.1', 'WAITING_FOR_REVIEW', 'b9')], '1.15.1', 'b2')
    expect(plan).toEqual({
      kind: 'blocked',
      reason: '1.15.1 is WAITING_FOR_REVIEW with another build',
    })
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
