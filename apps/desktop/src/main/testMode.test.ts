import { describe, expect, test } from 'bun:test'
import { isMockNetworkPage } from './testMode'

describe('pages a test build does not open', () => {
  test('a page on the mock network is not opened', () => {
    expect(isMockNetworkPage('http://127.0.0.1:4100/approve/r1', 'http://127.0.0.1:4100')).toBe(
      true,
    )
  })

  test('a share link opens even when the build runs on a mock network', () => {
    expect(isMockNetworkPage('https://share.sia.storage/#share=ab', 'http://127.0.0.1:4100')).toBe(
      false,
    )
  })

  test('a build with no mock network opens everything', () => {
    expect(isMockNetworkPage('http://127.0.0.1:4100/approve/r1', undefined)).toBe(false)
  })
})
