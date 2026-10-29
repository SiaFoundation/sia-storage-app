import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { calibrate, type CalibrationSample } from './stats'
import type { RunReport, TimingBaseline } from './types'

/*
 * Writes baseline/timing.json from A/A reports: CI runs where both sides ran
 * the same core code, downloaded from the benchmark job's artifacts.
 *
 *   gh run download <run-id> -n benchmark -D /tmp/bench/<run-id>
 *   bun run bench:calibrate /tmp/bench/<run-id>/report.json ...
 *
 * Reports that compared different code are skipped, since their differences
 * are not all noise. Every spec in any report gets a tolerance, and the
 * runner CPUs the reports came from are recorded, so a later run on a CPU not
 * in that list says its tolerances were not calibrated there.
 */

const thisDir = path.dirname(fileURLToPath(import.meta.url))
const timingPath = path.resolve(thisDir, '..', '..', 'baseline', 'timing.json')

function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('usage: bun run bench:calibrate <report.json>...')
    process.exit(1)
  }

  const reports = files
    .map((f) => ({ file: f, report: JSON.parse(fs.readFileSync(f, 'utf8')) as RunReport }))
    .filter(({ file, report }) => {
      if (!report.sameCode) console.error(`skipping ${file}: its two sides ran different code`)
      return report.sameCode
    })
    .map(({ report }) => report)
  if (reports.length === 0) throw new Error('no A/A reports to calibrate from')

  const rounds = reports[0].rounds
  if (reports.some((r) => r.rounds !== rounds)) {
    throw new Error('reports ran different round counts, so their medians are not comparable')
  }

  const samples = new Map<string, CalibrationSample[]>()
  for (const report of reports) {
    for (const suite of report.suites) {
      for (const spec of suite.specs) {
        // A spec that failed, or was skipped for running no SQL, has short or
        // empty rounds, and a median of nothing would make its thresholds NaN.
        if (spec.headError || spec.baseError || !spec.baseRounds) continue
        if (spec.headRounds.length < rounds || spec.baseRounds.length < rounds) continue
        // Only the first `rounds` entries: confirmation rounds run only for
        // suspects, so including them would weight noisy specs differently.
        const key = `${suite.name}/${spec.name}`
        const list = samples.get(key) ?? []
        list.push({
          headRounds: spec.headRounds.slice(0, rounds),
          baseRounds: spec.baseRounds.slice(0, rounds),
        })
        samples.set(key, list)
      }
    }
  }

  const runners = new Map<string, TimingBaseline['runners'][number]>()
  for (const { runner } of reports) {
    const { node: _node, ...rest } = runner
    runners.set(`${runner.cpu}|${runner.cores}`, rest)
  }

  const baseline: TimingBaseline = {
    rounds,
    runners: [...runners.values()],
    specs: Object.fromEntries(
      [...samples.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, list]) => [key, calibrate(list, rounds)]),
    ),
  }
  fs.writeFileSync(timingPath, `${JSON.stringify(baseline, null, 2)}\n`)
  console.log(
    `Wrote ${Object.keys(baseline.specs).length} tolerances from ${reports.length} runs to ${timingPath}`,
  )
  for (const [key, spec] of Object.entries(baseline.specs)) {
    console.log(
      `  ${key.padEnd(50)} ${String(spec.medianMs).padStart(9)} ms  ±${Math.round((spec.tolerance - 1) * 100)}%  floor ${spec.floorMs} ms`,
    )
  }
}

main()
