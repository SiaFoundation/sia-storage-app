// ANSI color codes for terminal output.
export const ANSI_RESET = '\x1b[0m'
export const ANSI_BOLD = '\x1b[1m'
const ANSI_CYAN = '\x1b[36m'
const ANSI_GREEN = '\x1b[32m'
const ANSI_YELLOW = '\x1b[33m'
const ANSI_RED = '\x1b[31m'
const ANSI_BLUE = '\x1b[34m'
const ANSI_MAGENTA = '\x1b[35m'

// Hex colors for UI display.
const HEX_CYAN = '#06b6d4'
const HEX_GREEN = '#22c55e'
const HEX_YELLOW = '#eab308'
const HEX_RED = '#ef4444'
const HEX_BLUE = '#3b82f6'
const HEX_MAGENTA = '#d946ef'
const HEX_LIGHT_RED = '#f87171'
const HEX_LIGHT_GREEN = '#4ade80'
const HEX_LIGHT_YELLOW = '#fbbf24'
const HEX_LIGHT_BLUE = '#60a5fa'
const HEX_LIGHT_MAGENTA = '#f472b6'
const HEX_LIGHT_CYAN = '#34d399'

// Log level colors.
export const LEVEL_COLORS = {
  debug: { ansi: ANSI_CYAN, hex: HEX_CYAN },
  info: { ansi: ANSI_GREEN, hex: HEX_GREEN },
  warn: { ansi: ANSI_YELLOW, hex: HEX_YELLOW },
  error: { ansi: ANSI_RED, hex: HEX_RED },
} as const

// Scope color palette.
export const SCOPE_COLORS = [
  { ansi: ANSI_MAGENTA, hex: HEX_MAGENTA },
  { ansi: ANSI_BLUE, hex: HEX_BLUE },
  { ansi: ANSI_CYAN, hex: HEX_CYAN },
  { ansi: ANSI_YELLOW, hex: HEX_YELLOW },
  { ansi: ANSI_GREEN, hex: HEX_GREEN },
  { ansi: ANSI_RED, hex: HEX_RED },
  { ansi: ANSI_RED, hex: HEX_LIGHT_RED },
  { ansi: ANSI_GREEN, hex: HEX_LIGHT_GREEN },
  { ansi: ANSI_YELLOW, hex: HEX_LIGHT_YELLOW },
  { ansi: ANSI_BLUE, hex: HEX_LIGHT_BLUE },
  { ansi: ANSI_MAGENTA, hex: HEX_LIGHT_MAGENTA },
  { ansi: ANSI_CYAN, hex: HEX_LIGHT_CYAN },
] as const

// Map of scope to color index.
const scopeColorMap = new Map<string, number>()

/** Get ANSI color code for a scope. */
export function getScopeColorAnsi(scope: string): string {
  if (!scopeColorMap.has(scope)) {
    scopeColorMap.set(scope, scopeColorMap.size % SCOPE_COLORS.length)
  }
  const index = scopeColorMap.get(scope) ?? 0
  return SCOPE_COLORS[index]?.ansi ?? SCOPE_COLORS[0]?.ansi ?? ANSI_CYAN
}

/** Get hex color for a scope. */
export function getScopeColorHex(scope: string): string {
  if (!scopeColorMap.has(scope)) {
    scopeColorMap.set(scope, scopeColorMap.size % SCOPE_COLORS.length)
  }
  const index = scopeColorMap.get(scope) ?? 0
  return SCOPE_COLORS[index]?.hex ?? SCOPE_COLORS[0]?.hex ?? HEX_CYAN
}

/** Get ANSI color code for a log level. */
export function getLevelColorAnsi(level: 'debug' | 'info' | 'warn' | 'error'): string {
  return LEVEL_COLORS[level]?.ansi ?? ANSI_CYAN
}

/** Get hex color for a log level. */
export function getLevelColorHex(level: 'debug' | 'info' | 'warn' | 'error'): string {
  return LEVEL_COLORS[level]?.hex ?? HEX_CYAN
}
