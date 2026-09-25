import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

/*
 * A file added by `sia add` or `sia import` in the released CLI and desktop
 * builds has the bare hex SHA-256 in files.hash, on the device that added it
 * and on every device that synced it. Every other path stores "sha256:" then
 * the hex, and hashes are compared as strings, so this rewrites each bare
 * 64-character hex value into that form. Metadata still on the indexer in the
 * bare form gains the prefix when it is decoded.
 *
 * The change feed stamps every rewritten row, and a Finder item's content
 * version is its hash, so Finder refreshes each of those items once.
 */
async function up(db: DatabaseAdapter): Promise<void> {
  await db.execAsync(
    `UPDATE files SET hash = 'sha256:' || lower(hash)
     WHERE length(hash) = 64 AND hash NOT GLOB '*[^0-9a-fA-F]*';`,
  )
}

export const migration_20260925_130000_prefix_content_hashes: Migration = {
  id: '20260925_130000_prefix_content_hashes',
  description: 'Prefix bare hex content hashes with sha256:.',
  up,
}
