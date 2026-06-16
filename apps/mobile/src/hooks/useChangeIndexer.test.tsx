import { act, renderHook } from '@testing-library/react-native'
import { buildIndexerURL, stripProtocol } from '../lib/indexerURL'
import { useChangeIndexer } from './useChangeIndexer'

jest.mock('@siastorage/core/stores', () => ({
  useIndexerURL: () => ({ data: '' }),
}))

jest.mock('../lib/toastContext', () => ({
  useToast: () => ({ show: jest.fn() }),
}))

jest.mock('../stores/sdk', () => ({
  authenticateIndexer: jest.fn(),
}))

describe('indexer URL helpers', () => {
  it('strips any leading scheme and whitespace, leaving the host', () => {
    expect(stripProtocol('  https://example.com  ')).toBe('example.com')
    expect(stripProtocol('http://example.com')).toBe('example.com')
    expect(stripProtocol('HTTPS://Example.com')).toBe('Example.com')
    expect(stripProtocol('ftp://example.com')).toBe('example.com')
    expect(stripProtocol('example.com')).toBe('example.com')
    expect(stripProtocol('https:// example.com ')).toBe('example.com')
    expect(stripProtocol('')).toBe('')
  })

  it('collapses an accidentally repeated scheme rather than leaking one through', () => {
    expect(stripProtocol('https://https://example.com')).toBe('example.com')
    expect(stripProtocol('https://https://https://example.com')).toBe('example.com')
  })

  it('always builds an https URL from a host', () => {
    expect(buildIndexerURL('example.com')).toBe('https://example.com')
    expect(buildIndexerURL('http://example.com')).toBe('https://example.com')
    expect(buildIndexerURL('ftp://example.com')).toBe('https://example.com')
    expect(buildIndexerURL('https://example.com:9999/path')).toBe('https://example.com:9999/path')
  })

  it('returns an empty string when no host has been entered', () => {
    expect(buildIndexerURL('')).toBe('')
    expect(buildIndexerURL('   ')).toBe('')
    expect(buildIndexerURL('https://')).toBe('')
  })
})

describe('useChangeIndexer', () => {
  it('keeps onChangeText stable across renders so typing does not clear the field', () => {
    // Regression: OnboardingAdvancedIndexerScreen resets the field in a focus
    // effect keyed on this callback. If the reference changed on every render,
    // the effect re-ran on each keystroke and wiped the input as the user typed.
    const { result, rerender } = renderHook(() => useChangeIndexer())
    const first = result.current.newIndexerInputProps.onChangeText

    act(() => {
      result.current.newIndexerInputProps.onChangeText('h')
    })
    rerender({})

    expect(result.current.newIndexerInputProps.onChangeText).toBe(first)
    expect(result.current.newIndexerInputProps.value).toBe('h')
  })

  it('strips a pasted protocol from the input and resolves a full https URL', () => {
    const { result } = renderHook(() => useChangeIndexer())

    act(() => {
      result.current.newIndexerInputProps.onChangeText('https://my-indexer.com')
    })

    expect(result.current.newIndexerInputProps.value).toBe('my-indexer.com')
    expect(result.current.indexerURL).toBe('https://my-indexer.com')
  })
})
