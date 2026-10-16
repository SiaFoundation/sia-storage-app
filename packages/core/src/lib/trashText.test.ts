import type { TrashEntry } from '../types/files'
import { itemCount, purgeLabel, restoredText, trashEntryDetail } from './trashText'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_800_000_000_000

function entry(overrides: Partial<TrashEntry> = {}): TrashEntry {
  return {
    id: 'e1',
    name: 'notes.txt',
    type: 'text/plain',
    size: 1,
    folder: null,
    versions: 1,
    trashedAt: NOW,
    purgeAt: NOW + 30 * DAY,
    ...overrides,
  }
}

describe('itemCount', () => {
  it('says one item, and counts more with thousands separated', () => {
    expect(itemCount(1)).toBe('1 item')
    expect(itemCount(0)).toBe('0 items')
    expect(itemCount(1200)).toBe(`${(1200).toLocaleString()} items`)
  })
})

describe('purgeLabel', () => {
  it('rounds part of a day up, so a day and a minute left reads as two days', () => {
    expect(purgeLabel(NOW + DAY + 60_000, NOW)).toBe('Deleted in 2 days')
  })

  it('says one day at exactly a day, and for anything less', () => {
    expect(purgeLabel(NOW + DAY, NOW)).toBe('Deleted in 1 day')
    expect(purgeLabel(NOW + 1, NOW)).toBe('Deleted in 1 day')
  })

  it('says soon once the purge time has passed, since the hourly purge has not run yet', () => {
    expect(purgeLabel(NOW, NOW)).toBe('Deleted soon')
    expect(purgeLabel(NOW - DAY, NOW)).toBe('Deleted soon')
  })
})

describe('trashEntryDetail', () => {
  it('gives the folder, or No folder, and when it is deleted', () => {
    expect(trashEntryDetail(entry(), NOW)).toBe('No folder · Deleted in 30 days')
    expect(trashEntryDetail(entry({ folder: 'Trips' }), NOW)).toBe('Trips · Deleted in 30 days')
  })

  it('counts versions only when there is more than one', () => {
    expect(trashEntryDetail(entry({ versions: 3 }), NOW)).toBe(
      'No folder · 3 versions · Deleted in 30 days',
    )
  })
})

describe('restoredText', () => {
  it('says the file is gone when the restore found it no longer in the trash', () => {
    expect(restoredText('notes.txt', [])).toBe('notes.txt is no longer in the trash.')
  })

  it('names the new name when another file had taken the old one', () => {
    expect(
      restoredText('notes.txt', [
        { id: 'a', name: 'notes (restored).txt', renamedFrom: 'notes.txt' },
      ]),
    ).toBe('Restored as notes (restored).txt, since the name is taken.')
  })

  it('says restored under the old name otherwise', () => {
    expect(restoredText('notes.txt', [{ id: 'a', name: 'notes.txt', renamedFrom: null }])).toBe(
      'Restored notes.txt.',
    )
  })
})
