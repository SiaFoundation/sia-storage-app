import type { Verdict } from './stats'
import type { StructureChange } from './structure'
import type { RunReport, SpecReport } from './types'

/*
 * The PR comment. A pass is one line with every number folded into a
 * <details> block. A failure lists what failed and shows those rows and plan
 * diffs open, with the full results still folded below.
 *
 * GitHub markdown has no text color, so colored cells use inline math
 * (`$\color{red}{...}$`). It renders on github.com and shows as raw TeX in
 * email notifications.
 */

export const COMMENT_MARKER = '<!-- sia-benchmark -->'

/** Room for statement and plan diffs. GitHub refuses a comment over 65,536
 * characters, and a failed post would leave an older comment in place, so
 * diffs past this are counted rather than shown. The full results table
 * after them stays under 10,000 characters for the current 40 specs. */
const STRUCTURE_BUDGET = 40_000

const VERDICT_COLOR: Partial<Record<Verdict, string>> = {
  slower: 'red',
  faster: 'green',
  unsteady: 'orange',
}

function colored(text: string, color: string | undefined): string {
  if (!color) return text
  return `$\\color{${color}}{\\textsf{${text.replace(/%/g, '\\%')}}}$`
}

function ms(value: number | null): string {
  if (value === null) return '-'
  if (value >= 100) return `${value.toFixed(0)} ms`
  if (value >= 10) return `${value.toFixed(1)} ms`
  return `${value.toFixed(2)} ms`
}

function percent(ratio: number): string {
  const p = (ratio - 1) * 100
  const sign = p > 0 ? '+' : ''
  return `${sign}${p.toFixed(Math.abs(p) < 10 ? 1 : 0)}%`
}

function changeCell(spec: SpecReport): string {
  const c = spec.comparison
  if (spec.headError) return colored('failed', 'red')
  if (!c || c.ratio === null) return spec.baseError ? `no base: ${spec.baseError}` : '-'
  return colored(percent(c.ratio), VERDICT_COLOR[c.verdict])
}

function toleranceCell(spec: SpecReport): string {
  const t = `±${Math.round((spec.tolerance.tolerance - 1) * 100)}%`
  return spec.tolerance.calibrated ? t : `${t} (default)`
}

function roundsCell(spec: SpecReport): string {
  const c = spec.comparison
  return c && c.ratio !== null ? `${c.slowerRounds} of ${c.rounds}` : '-'
}

function specTable(rows: { suite: string; spec: SpecReport }[]): string[] {
  const header = ['Operation', 'Base', 'PR', 'Change', 'Tolerance', 'Rounds slower']
  const lines = [
    `| ${header.join(' | ')} |`,
    `|${header.map((_, i) => (i === 0 ? '---' : '--:')).join('|')}|`,
  ]
  for (const { suite, spec } of rows) {
    const cells = [
      `\`${suite}/${spec.name}\``,
      ms(spec.comparison?.baseMs ?? null),
      ms(spec.comparison?.headMs ?? null),
      changeCell(spec),
      toleranceCell(spec),
      roundsCell(spec),
    ]
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines
}

function structureBlock(change: StructureChange): string[] {
  const color =
    change.direction === 'worse' ? 'red' : change.direction === 'better' ? 'green' : undefined
  const lines = [`**\`${change.suite}/${change.spec}\`**: ${colored(change.summary, color)}`, '']
  if (change.before.length > 0 || change.after.length > 0) {
    lines.push('```diff')
    for (const l of change.before) lines.push(`- ${l}`)
    for (const l of change.after) lines.push(`+ ${l}`)
    lines.push('```', '')
  }
  return lines
}

/** The comment for a run that stopped before it could time anything. */
export function buildFailedRunComment(message: string): string {
  return [
    COMMENT_MARKER,
    '### Benchmarks failed',
    '',
    'The run stopped before it finished, so nothing was compared. The job log has the details.',
    '',
    '```',
    message,
    '```',
    '',
  ].join('\n')
}

export function buildComment(report: RunReport): string {
  const all = report.suites.flatMap((suite) =>
    suite.specs.map((spec) => ({ suite: suite.name, spec })),
  )
  const slower = all.filter(({ spec }) => spec.comparison?.verdict === 'slower')
  const gating = slower.filter(({ spec }) => spec.tolerance.calibrated)
  const ungated = slower.filter(({ spec }) => !spec.tolerance.calibrated)
  const timed = all.filter(({ spec }) => spec.comparison)
  const faster = all.filter(({ spec }) => spec.comparison?.verdict === 'faster')
  const threw = all.filter(({ spec }) => spec.headError)
  const baseDown = report.suites.filter((suite) => suite.baseError)
  const noBase = all.filter(({ spec }) => spec.baseError)
  const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : 'unknown')
  const against =
    report.mode === 'compare' ? `base \`${short(report.base?.commit)}\`` : 'a second copy of itself'

  const out: string[] = [COMMENT_MARKER]
  out.push(report.failed ? '### Benchmarks failed' : '### Benchmarks passed', '')

  const summary: string[] = []
  summary.push(`${timed.length} operations timed against ${against}, ${report.rounds} rounds each.`)
  if (gating.length === 0 && ungated.length === 0)
    summary.push('None is slower beyond its tolerance.')
  if (faster.length > 0) summary.push(`${faster.length} faster.`)
  if (report.structureChanges.length === 0) {
    summary.push('Statement counts and query plans match the baseline.')
  }
  out.push(summary.join(' '), '')

  if (report.failed || ungated.length > 0 || baseDown.length > 0 || noBase.length > 0) {
    for (const { suite, spec } of gating) {
      const c = spec.comparison!
      out.push(
        `- \`${suite}/${spec.name}\` takes ${ms(c.headMs)}, ${percent(c.ratio!)} against ${ms(c.baseMs)} on base, beyond its ${toleranceCell(spec)} tolerance, and slower in ${c.slowerRounds} of ${c.rounds} rounds.`,
      )
    }
    for (const { suite, spec } of threw) {
      out.push(`- \`${suite}/${spec.name}\` failed: ${spec.headError}`)
    }
    // A missing base timing does not fail the check, since a PR that adds a
    // spec or changes a core API the harness calls has nothing on base to
    // time. It is listed here so a timing gap is never folded away.
    for (const suite of baseDown) {
      out.push(
        `- The base side of \`${suite.name}\` did not start, so none of its operations were timed against base: ${suite.baseError}`,
      )
    }
    for (const { suite, spec } of noBase) {
      out.push(`- \`${suite}/${spec.name}\` was not timed against base: ${spec.baseError}`)
    }
    for (const { suite, spec } of ungated) {
      out.push(
        `- \`${suite}/${spec.name}\` is ${percent(spec.comparison!.ratio!)} against base. It has no calibrated tolerance yet, so it does not fail the check.`,
      )
    }
    if (report.structureChanges.length > 0) {
      out.push(
        `- ${report.structureChanges.length} ${report.structureChanges.length === 1 ? 'change' : 'changes'} to statement counts, query plans or results against the committed baseline. If they are intended, run \`bun run --cwd apps/benchmark bench:baseline\` and commit \`apps/benchmark/baseline/structure.json\`.`,
      )
    }
    out.push('')

    const flagged = [...gating, ...ungated, ...threw]
    if (flagged.length > 0) out.push(...specTable(flagged), '')
    if (report.structureChanges.length > 0) {
      out.push('#### Statement and plan changes', '')
      let used = 0
      let shown = 0
      for (const change of report.structureChanges) {
        const block = structureBlock(change)
        const size = block.join('\n').length
        if (used + size > STRUCTURE_BUDGET) break
        out.push(...block)
        used += size
        shown++
      }
      const hidden = report.structureChanges.length - shown
      if (hidden > 0) {
        out.push(
          `${hidden} more ${hidden === 1 ? 'change does' : 'changes do'} not fit in a comment. All of them are in \`report.json\` in the job's \`benchmark\` artifact.`,
          '',
        )
      }
    }
  }

  out.push('<details>', '<summary>Full results</summary>', '')
  const r = report.runner
  out.push(
    `Runner: ${r.image ?? r.os}, ${r.cpu}, ${r.cores} cores, ${r.memoryGb} GB, node ${r.node}. ` +
      (report.calibratedRunner
        ? 'Tolerances were calibrated on this CPU.'
        : 'Tolerances were not calibrated on this CPU.') +
      ` Took ${Math.round(report.durationMs / 1000)}s.`,
    '',
  )
  out.push(
    "Base and PR are each side's median over the rounds. Change is the median of the per-round PR/base ratios, so its sign can differ from those two.",
    '',
  )
  if (report.sameCode) {
    out.push('Both sides ran the same core code, so this run is also a calibration sample.', '')
  }
  for (const suite of report.suites) {
    const d = suite.dataset
    out.push(
      `#### ${suite.name}`,
      '',
      `${d.totalRecords.toLocaleString('en-US')} records, ${d.currentFiles.toLocaleString('en-US')} current files` +
        (d.importFileCount ? `, ${d.importFileCount.toLocaleString('en-US')} import rows` : '') +
        '.' +
        (suite.baseError ? ` The base side did not start: ${suite.baseError}` : ''),
      '',
      ...specTable(suite.specs.map((spec) => ({ suite: suite.name, spec }))),
      '',
    )
  }
  out.push('</details>', '')
  return out.join('\n')
}
