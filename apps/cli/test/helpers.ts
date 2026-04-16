import { createBetterSqlite3Database } from '@siastorage/node-adapters/database'
import { createCliAppService, type CliApp } from '../src/app'

export function createTestApp(dataDir: string): Promise<CliApp> {
  return createCliAppService(dataDir, { createDatabase: createBetterSqlite3Database })
}
