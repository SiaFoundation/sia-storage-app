import type { DatabaseAdapter } from '../../adapters/db'
import type { Migration } from '../types'

/*
 * Finder asks the File Provider extension for a thumbnail of each cloud-only
 * file it shows. When the answer is an error, because the file's 512px
 * thumbnail has not synced or could not be downloaded, Finder shows the
 * plain icon and asks again only once the file's modification date changes.
 * The provider reports a cloud-only file's date one second later once its 512px
 * thumbnail is on this device, so the file has to be re-reported to the OS
 * when that happens.
 *
 * The trigger re-stamps the file a 512px thumbnail belongs to when a
 * download records the thumbnail's bytes in fs. Local generation writes fs
 * before the thumbnail row, so it does not fire the trigger. It does not
 * need to, because the scanner only thumbnails a file whose bytes are on
 * this device, and such a file reports no nudge. Only 512 counts, because that is the only size the provider
 * serves. thumbForId names one version's row, and a re-stamp of a version
 * that is no longer current reaches the OS as a redelivery of the current
 * one, which it ignores.
 *
 * Every file whose 512px thumbnail is already on this device is re-stamped
 * once, so its date moves and Finder asks about it again.
 */

const TRIGGERS: Array<{ name: string; sql: string }> = [
  {
    // fs is written with INSERT OR REPLACE, which fires the insert trigger
    // for a replaced row too, so every completed download of the thumbnail
    // re-stamps its file.
    name: 'trg_thumbnails_feed_local',
    sql: `CREATE TRIGGER trg_thumbnails_feed_local
   AFTER INSERT ON fs
   WHEN EXISTS (
     SELECT 1 FROM files WHERE id = NEW.fileId AND kind = 'thumb' AND thumbSize = 512
   )
   BEGIN
     UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;
     UPDATE files SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1)
       WHERE kind = 'file'
         AND id = (SELECT thumbForId FROM files WHERE id = NEW.fileId);
   END;`,
  },
]

async function up(db: DatabaseAdapter): Promise<void> {
  for (const { name, sql } of TRIGGERS) {
    await db.execAsync(`DROP TRIGGER IF EXISTS ${name};`)
    await db.execAsync(sql)
  }
  await db.execAsync(`UPDATE feed_meta SET seq = seq + 1 WHERE id = 1;`)
  await db.execAsync(
    `UPDATE files SET feedSeq = (SELECT seq FROM feed_meta WHERE id = 1)
     WHERE kind = 'file' AND id IN (
       SELECT t.thumbForId FROM files t JOIN fs ON fs.fileId = t.id
       WHERE t.kind = 'thumb' AND t.thumbSize = 512
     );`,
  )
}

export const migration_20261103_120000_thumbnail_feed_stamps: Migration = {
  id: '20261103_120000_thumbnail_feed_stamps',
  description: 'Re-report a file when its 512px thumbnail is downloaded or generated.',
  up,
}
