import type { SQLRunResult } from '@siastorage/core/adapters'
import {
  runSql as coreRunSql,
  sqlDelete as coreSqlDelete,
  sqlInsert as coreSqlInsert,
  sqlUpdate as coreSqlUpdate,
  type InsertOptions,
  type SqlValue,
} from '@siastorage/core/db/sql'
import { db } from '.'

export async function sqlInsert<
  T extends Record<string, string | number | boolean | null | undefined>,
>(table: string, row: T, options?: InsertOptions): Promise<SQLRunResult> {
  return coreSqlInsert(db(), table, row, options)
}

export async function runSql(
  sql: string,
  params: SqlValue[] = [],
): Promise<SQLRunResult> {
  return coreRunSql(db(), sql, params)
}

export async function sqlUpdate(
  table: string,
  fields: Record<string, SqlValue>,
  conditions: Record<string, SqlValue>,
): Promise<SQLRunResult> {
  return coreSqlUpdate(db(), table, fields, conditions)
}

export async function sqlDelete(
  table: string,
  conditions?: Record<string, SqlValue>,
): Promise<SQLRunResult> {
  return coreSqlDelete(db(), table, conditions)
}
