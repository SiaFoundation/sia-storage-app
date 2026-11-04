import { describe, expect, it } from 'bun:test'
import { finderPath } from './finderPath'

const MOUNT = '/Users/me/Library/CloudStorage/SiaStorage-SiaStorage'

describe('the Finder path of a library file', () => {
  it('puts a file at the top of the library directly under the mount', () => {
    expect(finderPath(MOUNT, null, 'notes.txt')).toBe(`${MOUNT}/notes.txt`)
  })

  it('puts a filed file under each of its folders', () => {
    expect(finderPath(MOUNT, 'Photos/2026', 'beach.jpg')).toBe(`${MOUNT}/Photos/2026/beach.jpg`)
  })

  it('refuses a name or folder that steps outside the mount', () => {
    expect(finderPath(MOUNT, null, '..')).toBeNull()
    expect(finderPath(MOUNT, '../..', 'x')).toBeNull()
    expect(finderPath(MOUNT, 'Photos/../..', 'x')).toBeNull()
    expect(finderPath(MOUNT, null, '../escape')).toBeNull()
  })

  it('keeps a name or folder that only starts with two dots', () => {
    expect(finderPath(MOUNT, null, '..notes.txt')).toBe(`${MOUNT}/..notes.txt`)
    expect(finderPath(MOUNT, '..drafts', 'x')).toBe(`${MOUNT}/..drafts/x`)
  })

  it('refuses an empty name or an empty folder segment', () => {
    expect(finderPath(MOUNT, null, '')).toBeNull()
    expect(finderPath(MOUNT, 'Photos//2026', 'x')).toBeNull()
  })
})
