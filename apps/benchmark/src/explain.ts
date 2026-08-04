import type { DatabaseAdapter, SQLParam } from '@siastorage/core/adapters'
import type { QuerySpec } from './types'

/*
 * Query plans for whatever the app actually ran.
 *
 * The statements live inside the ops functions, so a plan report built from a
 * hand-kept list of SQL strings would drift from them silently and assert index
 * usage the app never gets. Instead this wraps the adapter's read methods, runs
 * a spec once to collect the statements it issues verbatim, then EXPLAIN QUERY
 * PLANs each one with the same parameters.
 *
 * Reads only: writes are left alone so a spec's SQL is collected without its
 * side effects being replayed under EXPLAIN.
 */

export type CapturedPlan = {
  spec: string
  sql: string
  plan: string[]
}

type ReadMethod = 'getAllAsync' | 'getFirstAsync'

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

export async function capturePlans(
  db: DatabaseAdapter,
  specs: QuerySpec[],
): Promise<CapturedPlan[]> {
  const plans: CapturedPlan[] = []

  for (const spec of specs) {
    const seen: { sql: string; params: SQLParam[] }[] = []
    const originals: Partial<Record<ReadMethod, unknown>> = {}
    const target = db as unknown as Record<ReadMethod, (...a: unknown[]) => unknown>

    for (const method of ['getAllAsync', 'getFirstAsync'] as ReadMethod[]) {
      originals[method] = target[method]
      const original = target[method].bind(db)
      target[method] = (...args: unknown[]) => {
        const [sql, ...params] = args
        if (typeof sql === 'string') seen.push({ sql, params: params as SQLParam[] })
        return original(...args)
      }
    }

    try {
      await spec.run()
    } finally {
      for (const method of ['getAllAsync', 'getFirstAsync'] as ReadMethod[]) {
        target[method] = originals[method] as (...a: unknown[]) => unknown
      }
    }

    const emitted = new Set<string>()
    for (const { sql, params } of seen) {
      const key = normalize(sql)
      if (emitted.has(key)) continue
      emitted.add(key)
      const rows = await db.getAllAsync<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params)
      plans.push({ spec: spec.name, sql: key, plan: rows.map((r) => r.detail) })
    }
  }

  return plans
}
