const noColor = !!process.env.NO_COLOR

function wrap(code: string, text: string): string {
  if (noColor) return text
  return `\x1b[${code}m${text}\x1b[0m`
}

export const c = {
  green: (t: string) => wrap('32', t),
  red: (t: string) => wrap('31', t),
  yellow: (t: string) => wrap('33', t),
  cyan: (t: string) => wrap('36', t),
  magenta: (t: string) => wrap('35', t),
  dim: (t: string) => wrap('2', t),
  bold: (t: string) => wrap('1', t),
  sia: (t: string) => (noColor ? t : `\x1b[38;2;30;214;96m${t}\x1b[0m`),
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

export function formatRelativeDate(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Strip ANSI escape codes to get visible character count
// oxlint-disable-next-line no-control-regex -- intentional ANSI stripping
const ANSI_RE = /\x1b\[[0-9;]*m/g

function visibleLength(s: string): number {
  return s.replace(ANSI_RE, '').length
}

function padVisible(s: string, width: number): string {
  const visible = visibleLength(s)
  return visible >= width ? s : s + ' '.repeat(width - visible)
}

export function progressBar(ratio: number, width: number): string {
  const clamped = Math.max(0, Math.min(1, ratio))
  const filled = Math.round(clamped * width)
  return c.green('█'.repeat(filled)) + c.dim('░'.repeat(width - filled))
}

export function table(headers: string[], rows: string[][], widths?: number[]): string {
  const colWidths =
    widths ??
    headers.map((h, i) => Math.max(h.length, ...rows.map((r) => visibleLength(r[i] ?? ''))))

  const headerLine = headers.map((h, i) => padVisible(h, colWidths[i])).join('  ')
  const separator = colWidths.map((w) => '-'.repeat(w)).join('  ')
  const bodyLines = rows.map((row) =>
    row.map((cell, i) => padVisible(cell, colWidths[i])).join('  '),
  )

  return [headerLine, separator, ...bodyLines].join('\n')
}
