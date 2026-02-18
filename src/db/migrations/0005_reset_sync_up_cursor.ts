import { logger } from '../../lib/logger'
import { setAsyncStorageString } from '../../stores/asyncStore'
import type { Migration } from './types'

async function up(): Promise<void> {
  await setAsyncStorageString('syncUpCursor', '' as string)
  logger.info('db', 'migration_0005_reset_cursor')
}

export const migration_0005_reset_sync_up_cursor: Migration = {
  id: '0005_reset_sync_up_cursor',
  description:
    'Reset syncUpMetadata cursor to re-scan all files with v1 metadata.',
  up,
}
