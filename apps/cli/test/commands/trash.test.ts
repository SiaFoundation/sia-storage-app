import type { TrashEntry } from '@siastorage/core/types'
import { matchTrashEntry, optionsError, shownIds } from '../../src/commands/trash'

function entry(id: string, name: string, folder: string | null): TrashEntry {
  return { id, name, folder, type: 'text/plain', size: 1, versions: 1, trashedAt: 0, purgeAt: 0 }
}

const notes = entry('k3x9a1', 'notes.txt', null)
const tripNotes = entry('k3xq77', 'notes.txt', 'Trips')
const entries = [notes, tripNotes]

describe('naming a trash entry', () => {
  it('takes an id, the start of one, or a path with its folder', () => {
    expect(matchTrashEntry(entries, 'k3x9a1')).toBe(notes)
    expect(matchTrashEntry(entries, 'k3xq')).toBe(tripNotes)
    expect(matchTrashEntry(entries, 'Trips/notes.txt')).toBe(tripNotes)
    expect(matchTrashEntry(entries, 'notes.txt')).toBe(notes)
  })

  it('refuses a start of an id two entries share, and a name in none', () => {
    expect(matchTrashEntry(entries, 'k3x')).toMatch(/^"k3x" matches 2 entries/)
    expect(matchTrashEntry(entries, 'gone.txt')).toBe('Nothing in the trash matches "gone.txt".')
  })
})

describe('sia trash arguments', () => {
  it('refuses --empty beside a name or --delete, which would delete everything', () => {
    expect(optionsError(['notes.txt'], { empty: true })).toMatch(/takes no names/)
    expect(optionsError(['notes.txt'], { empty: true, delete: true })).toMatch(/takes no names/)
    expect(optionsError([], { empty: true, delete: true })).toMatch(/takes no names/)
  })

  it('takes --empty alone, and --delete with a name', () => {
    expect(optionsError([], { empty: true })).toBeNull()
    expect(optionsError(['notes.txt'], { delete: true })).toBeNull()
    expect(optionsError([], { delete: true })).toMatch(/^Name what to delete/)
  })
})

describe('ids in the trash list', () => {
  it('shows eight characters, and more where two ids share their first eight', () => {
    const shown = shownIds(['abcdefgh11', 'abcdefgh22', 'zyxwvuts99'])
    expect(shown.get('abcdefgh11')).toBe('abcdefgh1')
    expect(shown.get('abcdefgh22')).toBe('abcdefgh2')
    expect(shown.get('zyxwvuts99')).toBe('zyxwvuts')
  })
})
