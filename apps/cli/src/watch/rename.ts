import { randomBytes } from 'node:crypto'
import { extname } from 'node:path'

const SCREENSHOT_RE =
  /^Screenshot \d{4}-\d{2}-\d{2} at \d{1,2}\.\d{2}\.\d{2}[\u202f\u00a0 ]?(?:AM|PM)?\.png$/i

export function isScreenshotFile(name: string): boolean {
  return SCREENSHOT_RE.test(name)
}

function generateNanoId(length: number = 6): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = randomBytes(length)
  let result = ''
  for (let i = 0; i < length; i++) {
    result += alphabet[bytes[i] % alphabet.length]
  }
  return result
}

/**
 * Rename a macOS screenshot file to a clean, URL-safe format with a random suffix.
 *
 * "Screenshot 2026-04-14 at 2.30.22 PM.png" → "screenshot-2026-04-14-143022-V1StGX.png"
 */
export function renameScreenshot(name: string): string {
  const ext = extname(name)
  const withoutExt = name.slice(0, -ext.length)

  // Parse: "Screenshot YYYY-MM-DD at H.MM.SS [AM|PM]"
  const match = withoutExt.match(
    /^Screenshot (\d{4}-\d{2}-\d{2}) at (\d{1,2})\.(\d{2})\.(\d{2})[\u202f\u00a0 ]?(AM|PM)?$/i,
  )

  if (!match) {
    // Can't parse — just append nanoid to original name
    const id = generateNanoId()
    return `${withoutExt}-${id}${ext}`
  }

  const [, date, hourStr, min, sec, ampm] = match
  let hour = parseInt(hourStr, 10)

  if (ampm) {
    const upper = ampm.toUpperCase()
    if (upper === 'PM' && hour !== 12) hour += 12
    if (upper === 'AM' && hour === 12) hour = 0
  }

  const hh = String(hour).padStart(2, '0')
  const id = generateNanoId()

  return `screenshot-${date}-${hh}${min}${sec}-${id}${ext.toLowerCase()}`
}
