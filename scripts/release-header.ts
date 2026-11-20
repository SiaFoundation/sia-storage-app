/**
 * The header every release PR opens with: what it releases, the steps of its
 * train with the current one in bold, and what merging does. It sits between
 * two HTML comments, so Store Review can rewrite it in a final PR's body
 * without touching the notes below it.
 */

const START = '<!-- release-status -->'
const END = '<!-- /release-status -->'

export type Header = {
  title: string
  steps: readonly string[]
  current: number
  lines: readonly string[]
}

export const MOBILE_STEPS = ['Candidate', 'Testing', 'Review', 'Released'] as const
export const DESKTOP_STEPS = ['Candidate', 'Beta', 'Release'] as const

// Two trailing spaces are a markdown line break, which keeps the header as one
// block rather than a paragraph per line.
const BREAK = '  \n'

export function renderHeader({ title, steps, current, lines }: Header): string {
  const trail = steps.map((step, i) => (i === current ? `**${step}**` : step)).join(' › ')
  const top = [`**${title}**`, ...(trail ? [trail] : [])].join(BREAK)
  return [START, top, '', lines.join(BREAK), END].join('\n')
}

/** `body` with its header replaced by `header`, or with `header` added on top. */
export function withHeader(body: string, header: string): string {
  const start = body.indexOf(START)
  const end = body.indexOf(END)
  if (start === -1 || end < start) return `${header}\n\n${body}`
  return `${body.slice(0, start)}${header}${body.slice(end + END.length)}`
}

/** The line of a header that starts with `label`, such as "App Store:". */
export function headerLine(body: string, label: string): string | null {
  const start = body.indexOf(START)
  const end = body.indexOf(END)
  if (start === -1 || end < start) return null
  const line = body
    .slice(start, end)
    .split('\n')
    .map((l) => l.trimEnd())
    .find((l) => l.startsWith(label))
  return line ?? null
}

export function mobileCandidateHeader(version: string, inReview: string | null): Header {
  const rc = version.replace(/^.*-(rc\.\d+)$/, '$1')
  return {
    title: `Mobile ${version}`,
    steps: MOBILE_STEPS,
    current: 0,
    lines: [
      `Merging sends ${rc} to TestFlight and Google Play internal testing.`,
      ...(inReview ? [inReview] : []),
    ],
  }
}

export type MobileFinal = {
  version: string
  candidate: string
  buildNumber: string
  /** The App Store line, as Store Review last wrote it. */
  appStore: string
}

export function mobileFinalHeader(f: MobileFinal): Header {
  return {
    title: `Mobile ${f.version} from ${f.candidate}, build ${f.buildNumber}`,
    steps: MOBILE_STEPS,
    current: 2,
    lines: [
      f.appStore,
      'Google Play: sent for review. Google reports no review state, so check Play Console.',
      `Merge once both stores approve. Merging tags ${f.version} and releases it on the App Store, then publish it in Play Console.`,
    ],
  }
}

export function appStoreLine(label: string, since: Date): string {
  const time = since.toISOString().slice(11, 16)
  return `App Store: ${label} (since ${since.toISOString().slice(0, 10)} ${time} UTC)`
}

export function desktopCandidateHeader(version: string): Header {
  const rc = version.replace(/^.*-(rc\.\d+)$/, '$1')
  return {
    title: `Desktop ${version}`,
    steps: DESKTOP_STEPS,
    current: 0,
    lines: [`Merging sends ${rc} to the beta app.`],
  }
}

export function desktopFinalHeader(version: string, candidate: string): Header {
  return {
    title: `Desktop ${version} from ${candidate}`,
    steps: DESKTOP_STEPS,
    current: 2,
    lines: [`Merging tags ${version} and builds the shipping app.`],
  }
}

export function packagesHeader(versions: readonly string[]): Header {
  return {
    title: versions.join(', '),
    steps: [],
    current: 0,
    lines: ['Merging tags these versions, and a CLI version builds its binaries.'],
  }
}
