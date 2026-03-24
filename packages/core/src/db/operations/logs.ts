import type { LogLevel } from '@siastorage/logger'
import type { DatabaseAdapter } from '../../adapters/db'

type LogInsert = {
  timestamp: string
  level: string
  scope: string
  message: string
  data: string | null
  createdAt: number
}

export async function insertLog(
  db: DatabaseAdapter,
  entry: LogInsert,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO logs (timestamp, level, scope, message, data, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
    entry.timestamp,
    entry.level,
    entry.scope,
    entry.message,
    entry.data,
    entry.createdAt,
  )
}

export async function insertManyLogs(
  db: DatabaseAdapter,
  entries: LogInsert[],
): Promise<void> {
  if (entries.length === 0) return
  await db.withTransactionAsync(async () => {
    for (const entry of entries) {
      await db.runAsync(
        'INSERT INTO logs (timestamp, level, scope, message, data, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        entry.timestamp,
        entry.level,
        entry.scope,
        entry.message,
        entry.data,
        entry.createdAt,
      )
    }
  })
}

export async function queryAvailableLogScopes(
  db: DatabaseAdapter,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ scope: string }>(
    'SELECT DISTINCT scope FROM logs ORDER BY scope',
  )
  return rows.map((r) => r.scope)
}

function getLevelsForFilter(minLevel: LogLevel): LogLevel[] {
  const levelOrder: LogLevel[] = ['debug', 'info', 'warn', 'error']
  const minIndex = levelOrder.indexOf(minLevel)
  return levelOrder.slice(minIndex)
}

function buildLogFilterQuery(
  logLevel?: LogLevel,
  logScopes?: string[],
): { whereClause: string; params: (string | number)[] } {
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (logLevel) {
    const allowedLevels = getLevelsForFilter(logLevel)
    const placeholders = allowedLevels.map(() => '?').join(',')
    conditions.push(`level IN (${placeholders})`)
    params.push(...allowedLevels)
  }

  if (logScopes && logScopes.length > 0) {
    const placeholders = logScopes.map(() => '?').join(',')
    conditions.push(`scope IN (${placeholders})`)
    params.push(...logScopes)
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return { whereClause, params }
}

export type LogRow = {
  timestamp: string
  level: LogLevel
  scope: string
  message: string
  data: string | null
}

export async function queryLogs(
  db: DatabaseAdapter,
  opts?: { logLevel?: LogLevel; logScopes?: string[]; limit?: number },
): Promise<LogRow[]> {
  const { whereClause, params } = buildLogFilterQuery(
    opts?.logLevel,
    opts?.logScopes,
  )
  const limitClause =
    opts?.limit !== undefined && Number.isFinite(opts.limit)
      ? ` LIMIT ${opts.limit | 0}`
      : ''
  const query = `SELECT timestamp, level, scope, message, data FROM logs ${whereClause} ORDER BY createdAt DESC, id DESC${limitClause}`
  return db.getAllAsync<LogRow>(query, ...params)
}

export async function queryLogCount(
  db: DatabaseAdapter,
  opts?: { logLevel?: LogLevel; logScopes?: string[] },
): Promise<number> {
  const { whereClause, params } = buildLogFilterQuery(
    opts?.logLevel,
    opts?.logScopes,
  )
  const query = `SELECT COUNT(*) as count FROM logs ${whereClause}`
  const result = await db.getFirstAsync<{ count: number }>(query, ...params)
  return result?.count ?? 0
}

export async function deleteAllLogs(db: DatabaseAdapter): Promise<void> {
  await db.runAsync('DELETE FROM logs')
}

export async function rotateLogs(
  db: DatabaseAdapter,
  maxLogs: number,
): Promise<number> {
  const countResult = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM logs',
  )
  const count = countResult?.count ?? 0
  if (count <= maxLogs) return 0
  const toDelete = count - maxLogs
  await db.runAsync(
    `DELETE FROM logs WHERE id IN (
      SELECT id FROM logs ORDER BY createdAt ASC, id ASC LIMIT ?
    )`,
    toDelete,
  )
  return toDelete
}
