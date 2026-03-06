import type { LogLevel } from '@siastorage/logger'
import type { DatabaseAdapter } from '../../adapters/db'

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
