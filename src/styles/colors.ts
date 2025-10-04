// Centralized design color tokens for the app.
export const palette = {
  blue: {
    400: '#58a6ff', // Active/hover.
    500: '#0969da', // Primary brand.
  },
  red: {
    500: '#c83532', // Danger.
  },
  green: {
    500: '#22c55e', // Success.
  },
  yellow: {
    400: '#FFD166', // Warning.
  },
  slate: {
    700: '#334155',
  },
  gray: {
    50: '#ffffff',
    100: '#e6edf3',
    200: '#d0d7de',
    300: '#a6adbb',
    400: '#9aa4af',
    500: '#6b7280',
    600: '#3c3c43',
    700: '#2a2f36',
    800: '#1c1c1e',
    850: '#121417',
    875: '#111317',
    900: '#0b0d10',
    950: '#000000',
    975: '#24292f',
  },
  light: {
    100: '#f6f8fa',
    150: '#f3f4f6',
    200: '#eaeef2',
    250: '#f2f2f2',
    300: '#dddddd',
  },
  redExtended: {
    100: '#fee2e2',
    200: '#fecaca',
    700: '#991b1b',
  },
} as const

export const whiteA = {
  a02: 'rgba(255,255,255,0.02)',
  a08: 'rgba(255,255,255,0.08)',
  a10: 'rgba(255,255,255,0.10)',
  a20: 'rgba(255,255,255,0.20)',
  a50: 'rgba(255,255,255,0.50)',
  a70: 'rgba(255,255,255,0.70)',
  a85: 'rgba(255,255,255,0.85)',
  a90: 'rgba(255,255,255,0.90)',
} as const

export const blackA = {
  a20: 'rgba(0,0,0,0.20)',
  a100: 'rgba(0,0,0,1)',
} as const

// Overlay colors.
export const overlay = {
  pill: 'rgba(28,30,33,0.75)',
  panelStrong: 'rgba(18,20,23,0.90)',
  panelMedium: 'rgba(18,20,23,0.86)',
  panelLight: 'rgba(18,20,23,0.78)',
  blurTop: 'rgba(16,18,21,0.66)',
  blurBottom: 'rgba(16,18,21,0)',
  gradientTop: 'rgba(8,9,11,0.5)',
  gradientBottom: 'rgba(8,9,11,0)',
  menu: '#121417f0',
} as const

// Semantic tokens.
export const colors = {
  // Backgrounds.
  bgCanvas: palette.gray[900],
  bgPanel: palette.gray[850],
  bgElevated: palette.gray[875],
  bgSurface: palette.gray[50],
  bgPill: overlay.pill,

  // Borders.
  borderSubtle: palette.gray[700],
  borderMutedLight: palette.gray[200],

  // Text.
  textPrimary: palette.gray[50],
  textSecondary: whiteA.a70,
  textMuted: whiteA.a50,
  textTitleDark: '#111827',
  textDanger: palette.red[500],

  // Accents.
  accentPrimary: palette.blue[500],
  accentActive: palette.blue[400],
} as const

export type Colors = typeof colors
export type Palette = typeof palette
