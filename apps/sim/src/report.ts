/**
 * The record a scenario run leaves behind: which commit it ran, every step and
 * check with its result, and on failure what each device and the network looked
 * like. An agent cites the run id, and a reviewer reads this instead of taking
 * the agent's word for it.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CheckRecord, StepRecord } from './scenario'

/**
 * PASS: every check held. FAIL: a check failed, or a wait for the apps timed
 * out, after every device started. ERROR: the scenario never reached its
 * checks, because a device did not start, a precondition did not hold, or a
 * call threw. The error says which, and it can be the product or the harness.
 * KNOWN_BUG and FIXED are FAIL and PASS for a scenario that declares the bug
 * it catches. SKIP is a scenario whose devices this machine cannot run, such
 * as a desktop device off macOS.
 */
export type Verdict = 'PASS' | 'FAIL' | 'ERROR' | 'KNOWN_BUG' | 'FIXED' | 'SKIP'

/** Verdicts that fail a run. */
export const FAILING: ReadonlySet<Verdict> = new Set(['FAIL', 'ERROR', 'FIXED'])

export type ScenarioResult = {
  file: string
  name: string
  description: string
  knownBug?: string
  /** The known bug shows on some runs only, so a pass is PASS and not FIXED. */
  intermittent?: boolean
  needsReview?: string
  /** Crashes while starting the devices that a relaunch got past, as `device: first crash line`. */
  startCrashes?: string[]
  verdict: Verdict
  ms: number
  steps: StepRecord[]
  checks: CheckRecord[]
  notes: string[]
  error?: string
  /** Kept for failures: the session directory with every device's data and log. */
  sessionDir?: string
  diagnostics?: Record<string, unknown>
}

export type RunReport = {
  runId: string
  commit: string
  dirty: boolean
  startedAt: string
  ms: number
  results: ScenarioResult[]
}

/**
 * One line saying why a scenario failed the run, printed under its verdict
 * because a CI log shows the console output without the report file. A FAIL
 * gives its first failed check, or its error when a wait for the apps timed
 * out with every check passing. An ERROR gives its error, and a FIXED the
 * known bug that did not reproduce. Other verdicts give nothing.
 */
export function failureLine(r: ScenarioResult, max = 300): string | undefined {
  let reason: string | undefined
  if (r.verdict === 'FAIL') {
    const check = r.checks.find((c) => !c.ok)
    reason = check ? `${check.label}${check.detail ? `: ${check.detail}` : ''}` : r.error
  } else if (r.verdict === 'ERROR') {
    reason = r.error
  } else if (r.verdict === 'FIXED') {
    reason = r.knownBug && `the known bug did not reproduce: ${r.knownBug}`
  }
  const line = reason
    ?.split('\n')
    .map((l) => l.trim())
    .find(Boolean)
  if (!line) return undefined
  return line.length > max ? `${line.slice(0, max - 3)}...` : line
}

/**
 * Where a run stands, for a reader outside the process such as a CI step, to
 * which a job's own log is closed until the job ends. `latest` is the last
 * scenario to finish as `<VERDICT> <name>: <failure line>`, the failure line
 * empty for a verdict that has none, and empty before any has finished.
 */
export type Progress = {
  total: number
  done: number
  passed: number
  failed: number
  errored: number
  knownBug: number
  fixed: number
  skipped: number
  running: string[]
  /** The last scenario to finish, with its failure line when it did not pass. */
  latest: { verdict: Verdict; name: string; reason?: string } | null
}

export function progressOf(
  total: number,
  results: ScenarioResult[],
  running: string[],
  latest: ScenarioResult | undefined,
): Progress {
  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length
  return {
    total,
    done: results.length,
    passed: count('PASS'),
    failed: count('FAIL'),
    errored: count('ERROR'),
    knownBug: count('KNOWN_BUG'),
    fixed: count('FIXED'),
    skipped: count('SKIP'),
    running,
    latest: latest
      ? {
          verdict: latest.verdict,
          name: latest.name,
          ...(failureLine(latest) ? { reason: failureLine(latest) } : {}),
        }
      : null,
  }
}

/** Writes `progress` to `file` through a rename, so a reader never sees half a file. */
export function writeProgress(file: string, progress: Progress): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(progress)}\n`)
  renameSync(temp, file)
}

export function writeReport(dir: string, report: RunReport): { json: string; md: string } {
  mkdirSync(dir, { recursive: true })
  const json = join(dir, 'report.json')
  const md = join(dir, 'report.md')
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(md, renderMarkdown(report))
  return { json, md }
}

function renderMarkdown(report: RunReport): string {
  const lines = [
    `# sim run ${report.runId}`,
    '',
    `Commit ${report.commit}${report.dirty ? ' with uncommitted changes' : ''}, ${(report.ms / 1000).toFixed(1)}s.`,
    '',
    '| Verdict | Scenario | Checks | Time |',
    '|---|---|---|---|',
    ...report.results.map((r) => {
      const passed = r.checks.filter((c) => c.ok).length
      return `| ${r.verdict} | ${r.name} | ${passed}/${r.checks.length} | ${(r.ms / 1000).toFixed(1)}s |`
    }),
  ]
  for (const r of report.results) {
    lines.push('', `## ${r.verdict} ${r.name}`, '', r.description, '')
    if (r.knownBug) {
      lines.push(`${r.intermittent ? 'Intermittent known bug' : 'Known bug'}: ${r.knownBug}`, '')
    }
    if (r.needsReview) lines.push(`Needs review: ${r.needsReview}`, '')
    for (const crash of r.startCrashes ?? []) {
      lines.push(`Crashed while starting and was relaunched: ${crash}`, '')
    }
    for (const s of r.steps) {
      lines.push(
        `- step ${s.ok ? 'ok' : 'FAILED'} ${s.name} (${s.ms}ms)${s.error ? `: ${s.error}` : ''}`,
      )
    }
    for (const c of r.checks) {
      lines.push(`- check ${c.ok ? 'ok' : 'FAILED'} ${c.label}${c.detail ? `: ${c.detail}` : ''}`)
    }
    for (const n of r.notes) lines.push(`- note ${n}`)
    if (r.error) lines.push('', '```', r.error, '```')
    if (r.sessionDir) lines.push('', `Kept for inspection: ${r.sessionDir}`)
  }
  return `${lines.join('\n')}\n`
}
