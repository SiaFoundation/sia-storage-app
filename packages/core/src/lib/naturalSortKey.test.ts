import { naturalSortKey } from './naturalSortKey'

describe('naturalSortKey', () => {
  it('returns null for null input', () => {
    expect(naturalSortKey(null)).toBeNull()
  })

  it('returns empty string for empty input', () => {
    expect(naturalSortKey('')).toBe('')
  })

  it('lowercases alphabetic strings', () => {
    expect(naturalSortKey('ABC')).toBe('abc')
    expect(naturalSortKey('Hello World')).toBe('hello world')
  })

  it('pads single numeric sequences', () => {
    expect(naturalSortKey('file2')).toBe('file' + '2'.padStart(20, '0'))
    expect(naturalSortKey('file10')).toBe('file' + '10'.padStart(20, '0'))
  })

  it('pads multiple numeric sequences independently', () => {
    const key = naturalSortKey('v1.2.10')
    expect(key).toBe(
      'v' +
        '1'.padStart(20, '0') +
        '.' +
        '2'.padStart(20, '0') +
        '.' +
        '10'.padStart(20, '0'),
    )
  })

  it('produces correct natural sort order', () => {
    const names = ['file10', 'file2', 'file1', 'file20', 'file3']
    const sorted = [...names].sort((a, b) =>
      naturalSortKey(a)!.localeCompare(naturalSortKey(b)!),
    )
    expect(sorted).toEqual(['file1', 'file2', 'file3', 'file10', 'file20'])
  })

  it('handles case-insensitive natural sorting', () => {
    const names = ['File10', 'FILE2', 'file1']
    const sorted = [...names].sort((a, b) =>
      naturalSortKey(a)!.localeCompare(naturalSortKey(b)!),
    )
    expect(sorted).toEqual(['file1', 'FILE2', 'File10'])
  })

  it('handles leading zeros in original name', () => {
    const key7 = naturalSortKey('file007')!
    const key7plain = naturalSortKey('file7')!
    expect(key7).toBe(key7plain)
  })

  it('preserves numbers longer than 20 digits', () => {
    const longNum = '1'.repeat(25)
    const key = naturalSortKey('file' + longNum)
    expect(key).toBe('file' + longNum)
  })

  it('handles path-style names with slashes', () => {
    const names = ['photos/2', 'photos/10', 'photos/1']
    const sorted = [...names].sort((a, b) =>
      naturalSortKey(a)!.localeCompare(naturalSortKey(b)!),
    )
    expect(sorted).toEqual(['photos/1', 'photos/2', 'photos/10'])
  })

  it('handles names with dots, underscores, hyphens, spaces', () => {
    const key = naturalSortKey('IMG_2024-01-15 (3).jpg')
    expect(key).toBe(
      'img_' +
        '2024'.padStart(20, '0') +
        '-' +
        '01'.padStart(20, '0') +
        '-' +
        '15'.padStart(20, '0') +
        ' (' +
        '3'.padStart(20, '0') +
        ').jpg',
    )
  })

  it('handles purely numeric string', () => {
    expect(naturalSortKey('42')).toBe('42'.padStart(20, '0'))
  })
})
