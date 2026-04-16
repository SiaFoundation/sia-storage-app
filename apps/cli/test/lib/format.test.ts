import { formatBytes, formatRelativeDate, table } from '../../src/lib/format'

describe('formatBytes', () => {
  it('handles 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats KB', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats MB', () => {
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
  })

  it('formats GB', () => {
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB')
  })
})

describe('formatRelativeDate', () => {
  it('handles just now', () => {
    expect(formatRelativeDate(Date.now())).toBe('just now')
  })

  it('handles minutes', () => {
    expect(formatRelativeDate(Date.now() - 5 * 60 * 1000)).toBe('5m ago')
  })

  it('handles hours', () => {
    expect(formatRelativeDate(Date.now() - 3 * 60 * 60 * 1000)).toBe('3h ago')
  })

  it('handles days', () => {
    expect(formatRelativeDate(Date.now() - 7 * 24 * 60 * 60 * 1000)).toBe('7d ago')
  })
})

describe('table', () => {
  it('renders correct column widths', () => {
    const result = table(
      ['NAME', 'SIZE'],
      [
        ['file.txt', '1 KB'],
        ['photo.jpg', '2 MB'],
      ],
    )
    const lines = result.split('\n')
    expect(lines.length).toBe(4) // header + separator + 2 rows
    expect(lines[0]).toContain('NAME')
    expect(lines[0]).toContain('SIZE')
    expect(lines[2]).toContain('file.txt')
  })
})
