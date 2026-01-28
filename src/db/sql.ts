import type * as SQLite from 'expo-sqlite'
import { db } from '.'

type SqlValue = string | number | boolean | null | undefined
type SqlBindable = string | number | boolean

/**
 * Generic INSERT helper that:
 * - Inlines SQL NULL for nullish fields to avoid Android varargs null bridging issues.
 * - Binds only primitives (string | number) for the remaining fields.
 */
const insertConflictClauses = [
  'OR ROLLBACK',
  'OR ABORT',
  'OR REPLACE',
  'OR FAIL',
  'OR IGNORE',
] as const

type InsertConflictClause = (typeof insertConflictClauses)[number]

type InsertOptions = {
  conflictClause?: InsertConflictClause
}

export async function sqlInsert<
  T extends Record<string, string | number | boolean | null | undefined>,
>(
  table: string,
  row: T,
  options?: InsertOptions,
): Promise<SQLite.SQLiteRunResult> {
  const columns = Object.keys(row)
  const valuesSql: string[] = []
  const params: SqlBindable[] = []

  for (const key of columns) {
    const value = row[key]
    if (value === null || value === undefined) {
      valuesSql.push('NULL')
      continue
    }
    valuesSql.push('?')
    params.push(value)
  }

  const verb = options?.conflictClause
    ? `INSERT ${options.conflictClause}`
    : 'INSERT'

  const sql = `${verb} INTO ${table} (${columns.join(
    ', ',
  )}) VALUES (${valuesSql.join(', ')})`
  return await runSql(sql, params)
}

function normalizeSqlValue(value: SqlValue): string | number {
  if (value === null || value === undefined) {
    throw new Error(
      'Attempted to bind nullish SQL parameter. Inline NULL in the statement instead.',
    )
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return value
  }
  return String(value)
}

export async function runSql(
  sql: string,
  params: SqlValue[] = [],
): Promise<SQLite.SQLiteRunResult> {
  const normalized = params.map((value) => normalizeSqlValue(value))
  return await db().runAsync(sql, ...normalized)
}

type SqlFragment = {
  clause: string
  params: SqlBindable[]
}

function buildSqlAssignments(fields: Record<string, SqlValue>): SqlFragment {
  const assignments: string[] = []
  const params: SqlBindable[] = []

  for (const column of Object.keys(fields)) {
    const value = fields[column]
    if (value === undefined) {
      continue
    }
    if (value === null) {
      assignments.push(`${column} = NULL`)
      continue
    }
    assignments.push(`${column} = ?`)
    params.push(value)
  }

  return {
    clause: assignments.join(', '),
    params,
  }
}

function buildSqlWhereClause(
  conditions?: Record<string, SqlValue>,
): SqlFragment {
  if (!conditions) {
    return { clause: '', params: [] }
  }

  const parts: string[] = []
  const params: SqlBindable[] = []

  for (const column of Object.keys(conditions)) {
    const value = conditions[column]
    if (value === undefined) {
      continue
    }
    if (value === null) {
      parts.push(`${column} IS NULL`)
      continue
    }
    parts.push(`${column} = ?`)
    params.push(value)
  }

  const clause = parts.length ? ` WHERE ${parts.join(' AND ')}` : ''

  return { clause, params }
}

export async function sqlUpdate(
  table: string,
  fields: Record<string, SqlValue>,
  conditions: Record<string, SqlValue>,
): Promise<SQLite.SQLiteRunResult> {
  const { clause: assignments, params: setParams } = buildSqlAssignments(fields)
  if (!assignments) {
    return Promise.resolve({ changes: 0, lastInsertRowId: 0 })
  }

  const { clause: where, params: whereParams } = buildSqlWhereClause(conditions)
  const sql = `UPDATE ${table} SET ${assignments}${where}`
  return await runSql(sql, [...setParams, ...whereParams])
}

export async function sqlDelete(
  table: string,
  conditions?: Record<string, SqlValue>,
): Promise<SQLite.SQLiteRunResult> {
  const { clause, params } = buildSqlWhereClause(conditions)
  const sql = `DELETE FROM ${table}${clause}`
  return await runSql(sql, params)
}
