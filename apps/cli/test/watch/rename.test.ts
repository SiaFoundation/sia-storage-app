import { isScreenshotFile, renameScreenshot } from '../../src/watch/rename'

describe('isScreenshotFile', () => {
  it('matches standard macOS screenshot filename', () => {
    expect(isScreenshotFile('Screenshot 2026-04-14 at 2.30.22 PM.png')).toBe(true)
  })

  it('matches 24-hour format (no AM/PM)', () => {
    expect(isScreenshotFile('Screenshot 2026-04-14 at 14.30.22.png')).toBe(true)
  })

  it('matches AM timestamp', () => {
    expect(isScreenshotFile('Screenshot 2026-04-14 at 9.05.01 AM.png')).toBe(true)
  })

  it('matches with narrow no-break space before AM/PM', () => {
    // macOS sometimes uses \u202f (narrow no-break space) before AM/PM
    expect(isScreenshotFile('Screenshot 2026-04-14 at 2.30.22\u202fPM.png')).toBe(true)
  })

  it('rejects non-screenshot files', () => {
    expect(isScreenshotFile('photo.png')).toBe(false)
    expect(isScreenshotFile('document.pdf')).toBe(false)
    expect(isScreenshotFile('readme.txt')).toBe(false)
  })

  it('rejects partial matches', () => {
    expect(isScreenshotFile('Screenshot.png')).toBe(false)
    expect(isScreenshotFile('Screenshot 2026.png')).toBe(false)
  })
})

describe('renameScreenshot', () => {
  it('renames PM timestamp to 24-hour format with nanoid', () => {
    const result = renameScreenshot('Screenshot 2026-04-14 at 2.30.22 PM.png')
    expect(result).toMatch(/^screenshot-2026-04-14-143022-[A-Za-z0-9]{6}\.png$/)
  })

  it('renames AM timestamp correctly', () => {
    const result = renameScreenshot('Screenshot 2026-04-14 at 9.05.01 AM.png')
    expect(result).toMatch(/^screenshot-2026-04-14-090501-[A-Za-z0-9]{6}\.png$/)
  })

  it('handles 12 PM (noon)', () => {
    const result = renameScreenshot('Screenshot 2026-04-14 at 12.00.00 PM.png')
    expect(result).toMatch(/^screenshot-2026-04-14-120000-[A-Za-z0-9]{6}\.png$/)
  })

  it('handles 12 AM (midnight)', () => {
    const result = renameScreenshot('Screenshot 2026-04-14 at 12.00.00 AM.png')
    expect(result).toMatch(/^screenshot-2026-04-14-000000-[A-Za-z0-9]{6}\.png$/)
  })

  it('handles 24-hour format without AM/PM', () => {
    const result = renameScreenshot('Screenshot 2026-04-14 at 14.30.22.png')
    expect(result).toMatch(/^screenshot-2026-04-14-143022-[A-Za-z0-9]{6}\.png$/)
  })

  it('handles narrow no-break space before AM/PM', () => {
    const result = renameScreenshot('Screenshot 2026-04-14 at 2.30.22\u202fPM.png')
    expect(result).toMatch(/^screenshot-2026-04-14-143022-[A-Za-z0-9]{6}\.png$/)
  })

  it('generates unique IDs on each call', () => {
    const a = renameScreenshot('Screenshot 2026-04-14 at 2.30.22 PM.png')
    const b = renameScreenshot('Screenshot 2026-04-14 at 2.30.22 PM.png')
    expect(a).not.toBe(b)
  })

  it('lowercases the extension', () => {
    const result = renameScreenshot('Screenshot 2026-04-14 at 2.30.22 PM.PNG')
    expect(result).toMatch(/\.png$/)
  })
})
