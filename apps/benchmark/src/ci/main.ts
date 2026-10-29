import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { parseArgs } from 'util'
import { SUITE_NAMES, type SuiteName, type SuiteOptions } from '../suites'
import { buildComment, buildFailedRunComment } from './comment'
import { compareRounds, median, toleranceFor } from './stats'
import { diffStructure, type StructureBaseline, type SuiteStructure } from './structure'
import type { RunnerInfo, RunReport, SpecReport, SuiteReport, TimingBaseline } from './types'
import { WorkerProcess } from './workerProcess'

/*
 * The benchmark check CI runs on a PR.
 *
 * It seeds every suite twice, once on the PR's code and once on the base
 * commit's, in separate worker processes. It then checks the PR side's
 * statement counts and query plans against the committed baseline, and times
 * every spec on both sides in alternating rounds. The PR's harness code runs
 * on both sides: it is copied into the base checkout, so only core and the
 * adapters differ between them.
 *
 * Without --base, the second side is this same checkout, which measures how
 * far two identical runs drift apart on the machine. Those runs feed
 * `bench:calibrate`, which sets each spec's tolerance.
 *
 *   bun run bench:ci [--base <repo checkout>] [--rounds 6] [--suites library,imports]
 *   bun run bench:baseline       rewrites baseline/structure.json and exits
 */

const thisDir = path.dirname(fileURLToPath(import.meta.url))
const benchDir = path.resolve(thisDir, '..', '..')
const baselineDir = path.join(benchDir, 'baseline')
const structurePath = path.join(baselineDir, 'structure.json')
const timingPath = path.join(baselineDir, 'timing.json')

/** Library size the check seeds: about 250k records and 170k current files.
 * The 1M library takes minutes per side to seed, so it stays a manual
 * benchmark. */
const LIBRARY_SCALE = 0.25
const WARMUP = 2
/** Samples per side per round aim to add up to about this long. */
const ROUND_TARGET_MS = 150
const MIN_ITERATIONS = 1
const MAX_ITERATIONS = 25

const { values: args } = parseArgs({
  options: {
    base: { type: 'string' },
    rounds: { type: 'string', default: '6' },
    suites: { type: 'string', default: SUITE_NAMES.join(',') },
    out: { type: 'string', default: path.join(benchDir, 'results', 'ci') },
    'update-baseline': { type: 'boolean', default: false },
    'report-only': { type: 'boolean', default: false },
  },
})

function runnerInfo(): RunnerInfo {
  const cpus = os.cpus()
  return {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    image: process.env.ImageOS ?? null,
    cpu: cpus[0]?.model.trim() ?? 'unknown',
    cores: cpus.length,
    memoryGb: Math.round(os.totalmem() / 2 ** 30),
    node: process.version,
  }
}

function git(dir: string, ...gitArgs: string[]): string | null {
  try {
    return execFileSync('git', ['-C', dir, ...gitArgs], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** Both checkouts' committed trees for the code a spec runs, excluding the
 * harness, which is copied across. Equal trees mean an A/A run. */
function sameCode(headRoot: string, baseRoot: string): boolean {
  for (const tree of ['packages/core', 'packages/node-adapters', 'packages/logger', 'bun.lock']) {
    const a = git(headRoot, 'rev-parse', `HEAD:${tree}`)
    const b = git(baseRoot, 'rev-parse', `HEAD:${tree}`)
    if (!a || a !== b) return false
  }
  return true
}

function readJson<T>(file: string): T | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : null
}

function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let state = seed
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2 ** 31
    const j = state % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function main() {
  const started = Date.now()
  const rounds = Number(args.rounds)
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error(`--rounds must be a positive integer, got ${args.rounds}`)
  }
  const suites = args.suites.split(',').filter(Boolean) as SuiteName[]
  if (suites.length === 0) throw new Error('--suites names no suite')
  for (const s of suites) {
    if (!SUITE_NAMES.includes(s)) throw new Error(`unknown suite ${s}`)
  }
  const options: SuiteOptions = { scale: LIBRARY_SCALE }
  const headRoot = path.resolve(benchDir, '..', '..')
  const headWorker = path.join(thisDir, 'worker.ts')
  const runner = runnerInfo()

  // The base side runs this checkout's harness against the base checkout's
  // packages, so a spec added or changed by the PR is timed on both sides.
  let baseBench: string | null = null
  let baseWorker: string | null = null
  let copiedSrc: string | null = null
  if (!args['update-baseline']) {
    if (args.base) {
      baseBench = path.join(path.resolve(args.base), 'apps', 'benchmark')
      copiedSrc = path.join(baseBench, '.pr-src')
      fs.rmSync(copiedSrc, { recursive: true, force: true })
      fs.cpSync(path.join(benchDir, 'src'), copiedSrc, { recursive: true })
      baseWorker = path.join(copiedSrc, 'ci', 'worker.ts')
    } else {
      baseBench = benchDir
      baseWorker = headWorker
    }
  }

  const workers = suites.map((suite) => ({
    suite,
    head: new WorkerProcess(`pr:${suite}`, benchDir, headWorker, suite, options),
    base:
      baseBench && baseWorker
        ? new WorkerProcess(`base:${suite}`, baseBench, baseWorker, suite, options)
        : null,
  }))

  try {
    // Structure, from the PR side only: it is compared to the committed baseline.
    // The base side is profiled too, for its errors only, because profiling
    // runs every spec, and a spec that is not rolled back (the import scanner
    // tick) has to leave both databases at the same point before timing.
    const structure: StructureBaseline = {}
    const headProfileErrors: Record<string, Record<string, string>> = {}
    const baseProfile: Record<string, { errors: Record<string, string>; failed?: string }> = {}
    for (const { suite, head, base } of workers) {
      await head.ready
      const [reply, baseReply] = await Promise.all([
        head.request({ type: 'profile' }),
        base?.ready.then(() => base.request({ type: 'profile' })).catch((e) => e as Error),
      ])
      if (reply.type !== 'profiled') {
        throw new Error(`profiling ${suite} failed: ${reply.type === 'error' ? reply.message : ''}`)
      }
      structure[suite] = {
        ...(suite === 'library' ? { scale: LIBRARY_SCALE } : {}),
        specs: reply.specs,
      } satisfies SuiteStructure
      headProfileErrors[suite] = reply.errors
      // A base side that could not finish profiling is not at the same point
      // in the stateful specs as the PR side, so none of its timings count.
      baseProfile[suite] =
        baseReply instanceof Error || baseReply?.type === 'error'
          ? { errors: {}, failed: baseReply.message }
          : { errors: baseReply?.type === 'profiled' ? baseReply.errors : {} }
    }

    if (args['update-baseline']) {
      const threw = Object.entries(headProfileErrors).flatMap(([suite, errors]) =>
        Object.entries(errors).map(([spec, message]) => `${suite}/${spec}: ${message}`),
      )
      if (threw.length > 0) throw new Error(`specs threw while profiling:\n${threw.join('\n')}`)
      const existing = readJson<StructureBaseline>(structurePath) ?? {}
      fs.mkdirSync(baselineDir, { recursive: true })
      fs.writeFileSync(structurePath, `${JSON.stringify({ ...existing, ...structure }, null, 2)}\n`)
      console.log(`Wrote ${path.relative(process.cwd(), structurePath)}`)
      return
    }

    const committed = readJson<StructureBaseline>(structurePath) ?? {}
    // A spec that threw has no structure to compare, and is reported as failed
    // below rather than as removed from the baseline.
    const structureChanges = suites.flatMap((suite) =>
      diffStructure(suite, committed[suite], structure[suite]).filter(
        (change) => !headProfileErrors[suite][change.spec],
      ),
    )

    const timing = readJson<TimingBaseline>(timingPath)
    const calibratedRunner =
      timing?.runners.some((r) => r.cpu === runner.cpu && r.cores === runner.cores) ?? false

    // Timing waits for every worker to finish seeding, so no side is timed
    // while another process is still writing its database.
    await Promise.allSettled(workers.flatMap((w) => [w.head.ready, w.base?.ready]))

    const suiteReports: SuiteReport[] = []
    for (const { suite, head, base } of workers) {
      const ready = await head.ready
      let baseError: string | undefined
      const baseSpecs = new Set<string>()
      if (base) {
        try {
          for (const s of (await base.ready).specs) baseSpecs.add(s.name)
        } catch (e) {
          baseError = errorMessage(e)
        }
        baseError ??= baseProfile[suite].failed
      }

      const profiled = structure[suite].specs
      const headThrew = headProfileErrors[suite]
      const baseThrew = baseProfile[suite].errors
      const specs: SpecReport[] = ready.specs.map((s) => {
        const key = `${suite}/${s.name}`
        const p = profiled[s.name]
        // A spec that issues no SQL is timing an early return, as happens when
        // a stub adapter leaves an input empty, so it fails rather than passing.
        const silent = p && p.reads + p.writes + p.execs === 0
        const tolerance = toleranceFor(timing?.specs[key], timing?.rounds, rounds)
        const baseMissing = !baseSpecs.has(s.name)
          ? 'not in the base commit'
          : baseThrew[s.name]
            ? `threw while profiling: ${baseThrew[s.name]}`
            : undefined
        const headError = headThrew[s.name]
          ? `threw while profiling: ${headThrew[s.name]}`
          : silent
            ? 'runs no SQL statements, so it measures nothing'
            : undefined
        return {
          name: s.name,
          category: s.category,
          iterations: MIN_ITERATIONS,
          headRounds: [],
          baseRounds: base && !baseError && !baseMissing ? [] : null,
          ...(base && !baseError && baseMissing ? { baseError: baseMissing } : {}),
          comparison: null,
          tolerance,
          ...(headError ? { headError } : {}),
        }
      })

      console.error(`\n${suite}: warming up ${specs.length} specs`)
      for (const spec of specs) {
        if (spec.headError) continue
        try {
          const warm = await head.time(spec.name, WARMUP)
          spec.iterations = Math.min(
            MAX_ITERATIONS,
            Math.max(MIN_ITERATIONS, Math.ceil(ROUND_TARGET_MS / Math.max(median(warm), 0.01))),
          )
          console.error(
            `  ${spec.name}: ${median(warm).toFixed(2)} ms, ${spec.iterations} per round`,
          )
        } catch (e) {
          spec.headError = errorMessage(e)
        }
        if (spec.baseRounds && base) {
          try {
            await base.time(spec.name, WARMUP)
          } catch (e) {
            spec.baseRounds = null
            spec.baseError = errorMessage(e)
          }
        }
      }

      async function runRounds(targets: SpecReport[], count: number, seed: number) {
        for (let r = 0; r < count; r++) {
          console.error(`${suite}: round ${r + 1} of ${count}`)
          for (const spec of shuffled(targets, seed + r)) {
            if (spec.headError) continue
            // Alternate which side goes first, so neither always runs on the
            // caches and clock speed the other left behind.
            const sides =
              (seed + r) % 2 === 0 ? (['head', 'base'] as const) : (['base', 'head'] as const)
            for (const side of sides) {
              if (side === 'head') {
                try {
                  spec.headRounds.push(median(await head.time(spec.name, spec.iterations)))
                } catch (e) {
                  spec.headError = errorMessage(e)
                }
              } else if (spec.baseRounds && base) {
                try {
                  spec.baseRounds.push(median(await base.time(spec.name, spec.iterations)))
                } catch (e) {
                  spec.baseRounds = null
                  spec.baseError = errorMessage(e)
                }
              }
            }
          }
        }
      }

      function judge(spec: SpecReport) {
        if (spec.headError || spec.headRounds.length === 0) return
        spec.comparison = compareRounds(spec.headRounds, spec.baseRounds, spec.tolerance)
      }

      await runRounds(specs, rounds, 0)
      specs.forEach(judge)

      // A spec judged slower gets as many rounds again before it can fail the
      // check, and is judged on all of them.
      const suspects = specs.filter((s) => s.comparison?.verdict === 'slower')
      if (suspects.length > 0) {
        console.error(`${suite}: confirming ${suspects.map((s) => s.name).join(', ')}`)
        await runRounds(suspects, rounds, rounds)
        suspects.forEach(judge)
      }

      suiteReports.push({ name: suite, dataset: ready.dataset, baseError, specs })
    }

    const failures: string[] = []
    if (structureChanges.length > 0) {
      failures.push(
        `${structureChanges.length} statement count, query plan or result changes against the baseline`,
      )
    }
    for (const suite of suiteReports) {
      for (const spec of suite.specs) {
        if (spec.headError) failures.push(`${suite.name}/${spec.name} failed: ${spec.headError}`)
        if (spec.comparison?.verdict === 'slower' && spec.tolerance.calibrated) {
          failures.push(`${suite.name}/${spec.name} is slower than base`)
        }
      }
    }

    const report: RunReport = {
      version: 1,
      mode: args.base ? 'compare' : 'self',
      sameCode: args.base ? sameCode(headRoot, path.resolve(args.base)) : true,
      startedAt: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      runner,
      rounds,
      head: { commit: git(headRoot, 'rev-parse', 'HEAD') },
      base: args.base ? { commit: git(path.resolve(args.base), 'rev-parse', 'HEAD') } : null,
      calibratedRunner,
      suites: suiteReports,
      structureChanges,
      failed: failures.length > 0,
      failures,
    }

    fs.mkdirSync(args.out, { recursive: true })
    fs.writeFileSync(path.join(args.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    const comment = buildComment(report)
    fs.writeFileSync(path.join(args.out, 'comment.md'), comment)
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, comment)
    }
    console.log(comment)

    if (report.failed && !args['report-only']) process.exitCode = 1
  } finally {
    for (const w of workers) {
      w.head.stop()
      w.base?.stop()
    }
    if (copiedSrc) fs.rmSync(copiedSrc, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error(e)
  // The workflow posts comment.md whenever it exists, so a run that stops
  // early still replaces an earlier run's "passed" comment.
  const comment = buildFailedRunComment(errorMessage(e))
  fs.mkdirSync(args.out, { recursive: true })
  fs.writeFileSync(path.join(args.out, 'comment.md'), comment)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, comment)
  process.exit(1)
})
