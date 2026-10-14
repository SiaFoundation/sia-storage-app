// Upload-progress stats for the status surfaces: per media category, how many
// active files are uploaded to the given indexer and how many still wait, with
// byte totals and a percent derived from bytes.
//
// A file with no object on the indexer and no local copy (or one marked lost)
// can never upload. It is counted as unavailable and left out of `total`, so a
// category whose every other file is uploaded reads complete instead of stopping
// short forever.

import type { DatabaseAdapter } from '../../adapters/db'
import { buildRecordFilter } from './library'

export type UploadCategoryStats = {
  /** Uploaded plus remaining. Unavailable files are not included. */
  total: number
  remaining: number
  uploaded: number
  unavailable: number
  totalBytes: number
  uploadedBytes: number
  unavailableBytes: number
  percent: string
  percentDecimal: number
}

export type UploadStats = {
  overall: UploadCategoryStats
  files: UploadCategoryStats
  photos: UploadCategoryStats
  videos: UploadCategoryStats
  audio: UploadCategoryStats
  docs: UploadCategoryStats
  other: UploadCategoryStats
  thumbnails: UploadCategoryStats
}

async function queryStatsForWhere(
  db: DatabaseAdapter,
  where: string,
  indexerURL: string,
): Promise<UploadCategoryStats> {
  const totalRow = await db.getFirstAsync<{ count: number; bytes: number }>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(f.size), 0) AS bytes FROM files f WHERE ${where}`,
  )
  // Whether a file has a local copy is checked only for files not yet
  // uploaded, which are usually few. Checking it for every file makes the
  // query read the fs index once per row of the library.
  const waitingRow = await db.getFirstAsync<{
    count: number
    bytes: number
    remaining: number
    remainingBytes: number
  }>(
    `SELECT
       COUNT(*) AS count,
       COALESCE(SUM(size), 0) AS bytes,
       COALESCE(SUM(here), 0) AS remaining,
       COALESCE(SUM(CASE WHEN here THEN size ELSE 0 END), 0) AS remainingBytes
     FROM (
       SELECT
         f.size AS size,
         (f.lostReason IS NULL AND EXISTS (
           SELECT 1 FROM fs fsMeta WHERE fsMeta.fileId = f.id
         )) AS here
       FROM files f
       WHERE ${where}
         AND NOT EXISTS (
           SELECT 1 FROM objects obj WHERE obj.fileId = f.id AND obj.indexerURL = ?
         )
     )`,
    indexerURL,
  )
  const waiting = waitingRow?.count ?? 0
  const waitingBytes = waitingRow?.bytes ?? 0
  // The two reads share no transaction, so a file imported between them is
  // waiting without being in the total, which would make uploaded negative.
  const uploaded = Math.max(0, (totalRow?.count ?? 0) - waiting)
  const uploadedBytes = Math.max(0, (totalRow?.bytes ?? 0) - waitingBytes)
  const remaining = waitingRow?.remaining ?? 0
  const remainingBytes = waitingRow?.remainingBytes ?? 0
  const totalBytes = uploadedBytes + remainingBytes
  const percentDecimal = totalBytes ? uploadedBytes / totalBytes : 1
  const percent = `${(percentDecimal * 100).toFixed(1)}%`.padStart(6)
  return {
    total: uploaded + remaining,
    remaining,
    uploaded,
    unavailable: waiting - remaining,
    totalBytes,
    uploadedBytes,
    unavailableBytes: waitingBytes - remainingBytes,
    percent,
    percentDecimal,
  }
}

function sumCategories(categories: UploadCategoryStats[]): UploadCategoryStats {
  const total = categories.reduce((s, c) => s + c.total, 0)
  const uploaded = categories.reduce((s, c) => s + c.uploaded, 0)
  const remaining = categories.reduce((s, c) => s + c.remaining, 0)
  const unavailable = categories.reduce((s, c) => s + c.unavailable, 0)
  const totalBytes = categories.reduce((s, c) => s + c.totalBytes, 0)
  const uploadedBytes = categories.reduce((s, c) => s + c.uploadedBytes, 0)
  const unavailableBytes = categories.reduce((s, c) => s + c.unavailableBytes, 0)
  const percentDecimal = totalBytes ? uploadedBytes / totalBytes : 1
  const percent = `${(percentDecimal * 100).toFixed(1)}%`.padStart(6)
  return {
    total,
    remaining,
    uploaded,
    unavailable,
    totalBytes,
    uploadedBytes,
    unavailableBytes,
    percent,
    percentDecimal,
  }
}

export async function queryUploadStats(
  db: DatabaseAdapter,
  indexerURL: string,
): Promise<UploadStats> {
  const activeFile = buildRecordFilter('f')
  const q = (where: string) => queryStatsForWhere(db, where, indexerURL)

  const [photos, videos, audio, docs, other, thumbnails] = await Promise.all([
    q(`${activeFile} AND f.type LIKE 'image/%'`),
    q(`${activeFile} AND f.type LIKE 'video/%'`),
    q(`${activeFile} AND f.type LIKE 'audio/%'`),
    q(`${activeFile} AND (f.type LIKE 'text/%' OR f.type LIKE 'application/%')`),
    q(
      `${activeFile} AND f.type NOT LIKE 'image/%' AND f.type NOT LIKE 'video/%' AND f.type NOT LIKE 'audio/%' AND f.type NOT LIKE 'text/%' AND f.type NOT LIKE 'application/%'`,
    ),
    q(`f.kind = 'thumb' AND ${buildRecordFilter('f', { includeThumbnails: true })}`),
  ])

  const fileCategories = [photos, videos, audio, docs, other]

  return {
    overall: sumCategories([...fileCategories, thumbnails]),
    files: sumCategories(fileCategories),
    photos,
    videos,
    audio,
    docs,
    other,
    thumbnails,
  }
}
