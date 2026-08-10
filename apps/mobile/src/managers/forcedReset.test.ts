import Constants from 'expo-constants'
import { app } from '../stores/appService'
import {
  RESET_MARKER_KEYS,
  recordForcedReset,
  resolveForcedReset,
  resolveVariant,
  selectForcedResetAction,
} from './forcedReset'

// A jest.mock here does not displace the expo-constants mock in jest.setup.cjs,
// so the variant is set on that object instead.
const extra: Record<string, unknown> = {}
;(Constants as unknown as { expoConfig: { extra: Record<string, unknown> } }).expoConfig = { extra }

beforeEach(async () => {
  // Emptied rather than removed: a missing key reads as '' anyway, and the test
  // environment's AsyncStorage has no removeItem.
  for (const key of RESET_MARKER_KEYS) {
    await app().storage.setItem(key, '')
  }
  delete extra.variant
})

describe('resolveVariant', () => {
  it('recognizes dev and beta', () => {
    expect(resolveVariant('dev')).toBe('dev')
    expect(resolveVariant('beta')).toBe('beta')
  })

  it('falls back to prod for every value that is not an exact match', () => {
    for (const variant of ['prod', 'production', 'Beta', 'BETA', '', undefined, null, 0, {}, []]) {
      expect(resolveVariant(variant)).toBe('prod')
    }
  })
})

describe('selectForcedResetAction', () => {
  it('does nothing while the marker matches', () => {
    expect(selectForcedResetAction('a', 'a', true)).toBe('none')
  })

  it('does nothing for an unset nonce', () => {
    expect(selectForcedResetAction(null, 'anything', true)).toBe('none')
  })

  it('resets an onboarded device once the nonce has moved on', () => {
    expect(selectForcedResetAction('a2', 'a', true)).toBe('reset')
  })

  it('records instead of resetting before onboarding', () => {
    expect(selectForcedResetAction('a2', 'a', false)).toBe('record')
  })
})

describe('resolveForcedReset', () => {
  it('resets an onboarded device that has never recorded this build nonce', async () => {
    extra.variant = 'beta'
    expect(await resolveForcedReset(true)).toBe('reset')
  })

  it('records rather than resetting a device that has not onboarded', async () => {
    extra.variant = 'beta'
    expect(await resolveForcedReset(false)).toBe('record')
  })

  // Without the recorded nonce, the initApp right after sign-in resets the
  // account onboarding just created.
  it('leaves nothing pending once a pre-onboarding device has recorded', async () => {
    extra.variant = 'beta'
    expect(await resolveForcedReset(false)).toBe('record')
    await recordForcedReset()
    expect(await resolveForcedReset(true)).toBe('none')
  })

  it('records against its own variant marker and no other', async () => {
    extra.variant = 'beta'
    await recordForcedReset()
    expect(await app().storage.getItem('completedDevResetNonce')).toBe('')
    expect(await app().storage.getItem('completedProdResetNonce')).toBe('')
  })

  it('leaves a production build untouched by a dev or beta marker', async () => {
    extra.variant = 'prod'
    await app().storage.setItem('completedBetaResetNonce', 'a-nonce-prod-cannot-act-on')
    await app().storage.setItem('completedDevResetNonce', 'a-nonce-prod-cannot-act-on')
    expect(await resolveForcedReset(true)).toBe('none')
  })

  // A tripwire on the shipped configuration: arming production resets every
  // device on the store build, so it should take a deliberate test update.
  it('ships with no production reset pending', async () => {
    extra.variant = 'prod'
    expect(await resolveForcedReset(true)).toBe('none')
    await recordForcedReset()
    expect(await app().storage.getItem('completedProdResetNonce')).toBe('')
  })
})
