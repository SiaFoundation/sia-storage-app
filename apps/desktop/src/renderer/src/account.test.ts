import { describe, expect, it } from 'bun:test'
import { nextAccount } from './account'

describe('whether the window knows of an account', () => {
  it("takes the daemon's answer, whatever was known before", () => {
    expect(nextAccount('asking', true)).toBe('signed-in')
    expect(nextAccount('unreachable', false)).toBe('signed-out')
    expect(nextAccount('signed-out', true)).toBe('signed-in')
  })

  it('never reads a daemon that could not be asked as having no account', () => {
    expect(nextAccount('asking', null)).toBe('unreachable')
    expect(nextAccount('unreachable', null)).toBe('unreachable')
  })

  it('keeps an earlier answer through a read the daemon could not answer', () => {
    expect(nextAccount('signed-in', null)).toBe('signed-in')
    expect(nextAccount('signed-out', null)).toBe('signed-out')
  })
})
