import type { DatabaseAdapter, SQLParam } from '@siastorage/core/adapters'

/*
 * A database adapter that can record every statement passed through it.
 *
 * The ops functions issue their SQL from inside core, often inside a
 * transaction, so the only place to see all of it is the adapter. Statements
 * run inside `withTransactionAsync` go through the `tx` handed to the callback,
 * not the outer adapter, so the wrapper hands the callback a wrapped `tx` as
 * well. Recording is off unless `record` is running, so timing runs pay one
 * branch per statement.
 */

export type StatementKind = 'read' | 'write' | 'exec'

export type RecordedStatement = {
  kind: StatementKind
  sql: string
  params: SQLParam[]
}

export type InstrumentedDatabase = DatabaseAdapter & {
  record<T>(fn: () => Promise<T>): Promise<{ result: T; statements: RecordedStatement[] }>
}

export function instrumentDatabase(inner: DatabaseAdapter): InstrumentedDatabase {
  let sink: RecordedStatement[] | null = null

  function wrap(target: DatabaseAdapter): DatabaseAdapter {
    return {
      getAllAsync<T>(sql: string, ...params: SQLParam[]) {
        sink?.push({ kind: 'read', sql, params })
        return target.getAllAsync<T>(sql, ...params)
      },
      getFirstAsync<T>(sql: string, ...params: SQLParam[]) {
        sink?.push({ kind: 'read', sql, params })
        return target.getFirstAsync<T>(sql, ...params)
      },
      runAsync(sql: string, ...params: SQLParam[]) {
        sink?.push({ kind: 'write', sql, params })
        return target.runAsync(sql, ...params)
      },
      execAsync(sql: string) {
        sink?.push({ kind: 'exec', sql, params: [] })
        return target.execAsync(sql)
      },
      withTransactionAsync(fn) {
        return target.withTransactionAsync((tx) => fn(wrap(tx)))
      },
      close: target.close?.bind(target),
      finalize: target.finalize?.bind(target),
    }
  }

  return {
    ...wrap(inner),
    async record(fn) {
      if (sink) throw new Error('record() does not nest')
      const statements: RecordedStatement[] = []
      sink = statements
      try {
        const result = await fn()
        return { result, statements }
      } finally {
        sink = null
      }
    },
  }
}
