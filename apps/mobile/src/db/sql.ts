import type { SQLRunResult } from '@siastorage/core/adapters'
import type { InsertOptions, SqlValue } from '@siastorage/core/db/sql'
import * as sql from '@siastorage/core/db/sql'
import { db } from '.'

export async function insert<
  T extends Record<string, string | number | boolean | null | undefined>,
>(table: string, row: T, options?: InsertOptions): Promise<SQLRunResult> {
  return sql.insert(db(), table, row, options)
}

export async function run(
  query: string,
  params: SqlValue[] = [],
): Promise<SQLRunResult> {
  return sql.run(db(), query, params)
}

export async function update(
  table: string,
  fields: Record<string, SqlValue>,
  conditions: Record<string, SqlValue>,
): Promise<SQLRunResult> {
  return sql.update(db(), table, fields, conditions)
}

export async function del(
  table: string,
  conditions?: Record<string, SqlValue>,
): Promise<SQLRunResult> {
  return sql.del(db(), table, conditions)
}
