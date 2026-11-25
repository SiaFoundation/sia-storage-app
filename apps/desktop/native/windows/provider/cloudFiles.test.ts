import { describe, expect, it } from 'bun:test'
import { identityBytes } from './cloudFiles'

/*
 * The identity written to a placeholder has to fit the 256 bytes the C shim
 * copies into a callback's event, or the provider could not tell which file a
 * callback is about. The limit is in bytes, not characters.
 */
describe('identityBytes', () => {
  it('passes an identity of exactly 256 bytes', () => {
    expect(identityBytes('a'.repeat(256)).length).toBe(256)
  })

  it('refuses an identity over 256 bytes, counting a two-byte character as two', () => {
    expect(() => identityBytes('é'.repeat(129))).toThrow(/258 bytes/)
  })
})
