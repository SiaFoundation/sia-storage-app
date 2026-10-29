import { explainReads } from '../explain'
import type { InstrumentedDatabase } from '../instrument'
import { formatPreview } from '../runner'
import type { QuerySpec } from '../types'

/*
 * The part of a spec's cost that does not depend on the machine: how many
 * statements it issues, the plan SQLite picks for each read, and the shape of
 * what it returns. These come out the same on every run, so the committed
 * baseline is compared exactly. A dropped index, a lost LIMIT or a query run
 * once per row shows up here with no timing noise at all.
 */

export type SpecStructure = {
  reads: number
  writes: number
  execs: number
  result: string
  plans: { sql: string; plan: string[] }[]
}

export type SuiteStructure = {
  /** Library scale for the library suite, absent for fixed-size suites. */
  scale?: number
  specs: Record<string, SpecStructure>
}

export type StructureBaseline = Record<string, SuiteStructure>

export type Direction = 'worse' | 'better' | 'changed'

export type StructureChange = {
  suite: string
  spec: string
  what: 'statements' | 'plan' | 'result' | 'added' | 'removed'
  direction: Direction
  summary: string
  /** Old and new text for a diff block, one entry per line. */
  before: string[]
  after: string[]
}

export async function profileSpec(
  db: InstrumentedDatabase,
  spec: QuerySpec,
): Promise<SpecStructure> {
  // The first run fills caches some specs keep between iterations, such as the
  // id list the 10k directory specs look up once, so it is not the one recorded.
  await spec.run()
  const { result, statements } = await db.record(() => spec.run())
  const plans = await explainReads(db, spec.name, statements)
  return {
    reads: statements.filter((s) => s.kind === 'read').length,
    writes: statements.filter((s) => s.kind === 'write').length,
    execs: statements.filter((s) => s.kind === 'exec').length,
    result: formatPreview(result),
    plans: plans.map(({ sql, plan }) => ({ sql, plan })),
  }
}

/**
 * Profiles every spec in order. One spec throwing does not stop the rest,
 * because a later spec such as the import scanner tick changes the database,
 * and skipping it on one side would time the two sides against different data.
 */
export async function profileSpecs(
  db: InstrumentedDatabase,
  specs: QuerySpec[],
): Promise<{ specs: Record<string, SpecStructure>; errors: Record<string, string> }> {
  const result: Record<string, SpecStructure> = {}
  const errors: Record<string, string> = {}
  for (const spec of specs) {
    try {
      result[spec.name] = await profileSpec(db, spec)
    } catch (e) {
      errors[spec.name] = e instanceof Error ? e.message : String(e)
    }
  }
  return { specs: result, errors }
}

/** Plan lines that read a whole table or sort in a temporary b-tree. "SCAN x
 * USING INDEX" walks an index in order and is not counted. */
function costlyLines(plan: string[]): number {
  return plan.filter((line) => /^SCAN \S+$/.test(line) || line.includes('USE TEMP B-TREE')).length
}

function total(s: SpecStructure): number {
  return s.reads + s.writes + s.execs
}

function countsLine(s: SpecStructure): string {
  return `${total(s)} statements (${s.reads} reads, ${s.writes} writes, ${s.execs} other)`
}

export function diffStructure(
  suite: string,
  before: SuiteStructure | undefined,
  after: SuiteStructure,
): StructureChange[] {
  const changes: StructureChange[] = []
  const old = before?.specs ?? {}

  for (const [spec, now] of Object.entries(after.specs)) {
    const was = old[spec]
    if (!was) {
      changes.push({
        suite,
        spec,
        what: 'added',
        direction: 'changed',
        summary: 'not in the baseline',
        before: [],
        after: [countsLine(now)],
      })
      continue
    }

    if (now.reads !== was.reads || now.writes !== was.writes || now.execs !== was.execs) {
      const delta = total(now) - total(was)
      changes.push({
        suite,
        spec,
        what: 'statements',
        direction: delta > 0 ? 'worse' : delta < 0 ? 'better' : 'changed',
        summary:
          delta === 0
            ? `same ${total(now)} statements, different kinds`
            : `${total(was)} to ${total(now)} statements`,
        before: [countsLine(was)],
        after: [countsLine(now)],
      })
    }

    if (now.result !== was.result) {
      changes.push({
        suite,
        spec,
        what: 'result',
        direction: 'changed',
        summary: `returns ${now.result}, was ${was.result}`,
        before: [was.result],
        after: [now.result],
      })
    }

    const wasPlans = new Map(was.plans.map((p) => [p.sql, p.plan]))
    const nowPlans = new Map(now.plans.map((p) => [p.sql, p.plan]))
    for (const [sql, plan] of nowPlans) {
      const prior = wasPlans.get(sql)
      if (prior && prior.join('\n') === plan.join('\n')) continue
      const cost = costlyLines(plan) - (prior ? costlyLines(prior) : 0)
      changes.push({
        suite,
        spec,
        what: 'plan',
        direction: cost > 0 ? 'worse' : cost < 0 ? 'better' : 'changed',
        summary: prior ? 'query plan changed' : 'new statement',
        before: prior ? [sql, ...prior.map((l) => `  ${l}`)] : [],
        after: [sql, ...plan.map((l) => `  ${l}`)],
      })
    }
    for (const [sql, plan] of wasPlans) {
      if (nowPlans.has(sql)) continue
      changes.push({
        suite,
        spec,
        what: 'plan',
        direction: 'changed',
        summary: 'statement no longer issued',
        before: [sql, ...plan.map((l) => `  ${l}`)],
        after: [],
      })
    }
  }

  for (const spec of Object.keys(old)) {
    if (after.specs[spec]) continue
    changes.push({
      suite,
      spec,
      what: 'removed',
      direction: 'changed',
      summary: 'in the baseline but no longer run',
      before: [countsLine(old[spec])],
      after: [],
    })
  }

  return changes
}
