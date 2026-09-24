import { resolveVariant, selectForcedResetAction } from './forcedReset'

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

  it('resets an install with local data once the nonce has moved on', () => {
    expect(selectForcedResetAction('a2', 'a', true)).toBe('reset')
  })

  it('records instead of resetting while there is no local data yet', () => {
    expect(selectForcedResetAction('a2', 'a', false)).toBe('record')
  })
})
