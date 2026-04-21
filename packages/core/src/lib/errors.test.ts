import { AbortError, getErrorMessage, isAbortError } from './errors'

describe('AbortError', () => {
  it('has name AbortError and default message', () => {
    const e = new AbortError()
    expect(e.name).toBe('AbortError')
    expect(e.message).toBe('The operation was aborted.')
    expect(e).toBeInstanceOf(Error)
  })

  it('accepts a custom message', () => {
    expect(new AbortError('nope').message).toBe('nope')
  })
})

describe('isAbortError', () => {
  it('true for DOMException with name AbortError', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
  })

  it('true for our AbortError class', () => {
    expect(isAbortError(new AbortError())).toBe(true)
  })

  it('true for Error with name AbortError', () => {
    const e = new Error('aborted')
    e.name = 'AbortError'
    expect(isAbortError(e)).toBe(true)
  })

  it('true for an aborted AbortSignal.reason shape', () => {
    const controller = new AbortController()
    controller.abort()
    expect(isAbortError(controller.signal.reason)).toBe(true)
  })

  it('false for a non-abort Error', () => {
    expect(isAbortError(new Error('boom'))).toBe(false)
  })

  it('false for a DOMException with a different name', () => {
    expect(isAbortError(new DOMException('nope', 'SyntaxError'))).toBe(false)
  })

  it('false for null, undefined, strings, numbers', () => {
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
    expect(isAbortError(42)).toBe(false)
  })
})

describe('getErrorMessage', () => {
  it('returns Error.message', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns string value as-is', () => {
    expect(getErrorMessage('nope')).toBe('nope')
  })

  it('stringifies number and boolean primitives', () => {
    expect(getErrorMessage(42)).toBe('42')
    expect(getErrorMessage(true)).toBe('true')
  })

  it('returns default fallback for null, undefined, and objects', () => {
    expect(getErrorMessage(null)).toBe('An unknown error occurred')
    expect(getErrorMessage(undefined)).toBe('An unknown error occurred')
    expect(getErrorMessage({ a: 1 })).toBe('An unknown error occurred')
  })

  it('returns provided fallback for null, undefined, and objects', () => {
    expect(getErrorMessage(null, 'Failed to rename')).toBe('Failed to rename')
    expect(getErrorMessage({}, 'Failed to rename')).toBe('Failed to rename')
  })

  it('prefers Error.message even when fallback is provided', () => {
    expect(getErrorMessage(new Error('boom'), 'ignored')).toBe('boom')
  })

  it('accepts empty-string fallback for surfaces that want to show nothing', () => {
    expect(getErrorMessage({}, '')).toBe('')
  })
})
