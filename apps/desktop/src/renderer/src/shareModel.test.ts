import { describe, expect, it } from 'bun:test'
import { folderName, groupByFolder } from './shareModel'

describe('share view layout', () => {
  it('files are grouped under their folders, in the order the folders first appear', () => {
    const files = [
      { name: 'a.jpg', folder: 'Trips/Rome' },
      { name: 'b.txt', folder: null },
      { name: 'c.jpg', folder: 'Trips/Rome' },
    ]
    expect(groupByFolder(files)).toEqual([
      { folder: 'Trips/Rome', files: [files[0], files[2]] },
      { folder: null, files: [files[1]] },
    ])
  })

  it('a folder is named by its last part, and the top of the library by its Finder name', () => {
    expect(folderName('Trips/Rome', 'Sia Storage')).toBe('Rome')
    expect(folderName(null, 'Sia Storage')).toBe('Sia Storage')
  })
})
