import type { InstrumentedDatabase, RecordedStatement } from './instrument'
import type { QuerySpec } from './types'

/*
 * Query plans for whatever the app actually ran.
 *
 * The statements live inside the ops functions, so a plan report built from a
 * hand-kept list of SQL strings would drift from them silently and assert index
 * usage the app never gets. Instead this records the statements a spec issues
 * verbatim, through the instrumented adapter, then EXPLAIN QUERY PLANs each
 * read with the same parameters.
 *
 * Reads only: writes are left alone so a spec's SQL is collected without its
 * side effects being replayed under EXPLAIN.
 */

export type CapturedPlan = {
  spec: string
  sql: string
  plan: string[]
}

/** Collapses whitespace and runs of `?` placeholders, so an `IN (...)` over
 * 10k ids reads as one short statement and keys the same at any list length. */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\?(\s*,\s*\?)+/g, '?, …')
    .replace(/\(\?, …\)(\s*,\s*\(\?, …\))+/g, '(?, …), …')
    .trim()
}

export async function explainReads(
  db: InstrumentedDatabase,
  spec: string,
  statements: RecordedStatement[],
): Promise<CapturedPlan[]> {
  const plans: CapturedPlan[] = []
  const emitted = new Set<string>()
  for (const { kind, sql, params } of statements) {
    if (kind !== 'read') continue
    const key = normalizeSql(sql)
    if (emitted.has(key)) continue
    emitted.add(key)
    const rows = await db.getAllAsync<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params)
    plans.push({ spec, sql: key, plan: rows.map((r) => r.detail) })
  }
  return plans
}

export async function capturePlans(
  db: InstrumentedDatabase,
  specs: QuerySpec[],
): Promise<CapturedPlan[]> {
  const plans: CapturedPlan[] = []
  for (const spec of specs) {
    const { statements } = await db.record(() => spec.run())
    plans.push(...(await explainReads(db, spec.name, statements)))
  }
  return plans
}
