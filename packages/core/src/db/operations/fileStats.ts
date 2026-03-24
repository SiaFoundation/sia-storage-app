import type { DatabaseAdapter } from '../../adapters/db'
import { buildLatestVersionFilter } from './library'

export type UploadCategoryStats = {
  total: number
  remaining: number
  uploaded: number
  totalBytes: number
  uploadedBytes: number
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
  const totalRow = await db.getFirstAsync<{
    count: number
    totalBytes: number
  }>(
    `SELECT COUNT(*) as count, COALESCE(SUM(f.size), 0) as totalBytes FROM files f WHERE ${where}`,
  )
  const remainingRow = await db.getFirstAsync<{
    count: number
    totalBytes: number
  }>(
    `SELECT COUNT(*) as count, COALESCE(SUM(f.size), 0) as totalBytes
     FROM files f
     WHERE ${where}
       AND NOT EXISTS (
         SELECT 1 FROM objects o
         WHERE o.fileId = f.id AND o.indexerURL = ?
       )`,
    indexerURL,
  )
  const total = totalRow?.count ?? 0
  const totalBytes = totalRow?.totalBytes ?? 0
  const remaining = remainingRow?.count ?? 0
  const remainingBytes = remainingRow?.totalBytes ?? 0
  const uploaded = Math.max(0, total - remaining)
  const uploadedBytes = Math.max(0, totalBytes - remainingBytes)
  const percentDecimal = totalBytes ? uploadedBytes / totalBytes : 1
  const percent = `${(percentDecimal * 100).toFixed(1)}%`.padStart(6)
  return {
    total,
    remaining,
    uploaded,
    totalBytes,
    uploadedBytes,
    percent,
    percentDecimal,
  }
}

function sumCategories(categories: UploadCategoryStats[]): UploadCategoryStats {
  const total = categories.reduce((s, c) => s + c.total, 0)
  const uploaded = categories.reduce((s, c) => s + c.uploaded, 0)
  const remaining = categories.reduce((s, c) => s + c.remaining, 0)
  const totalBytes = categories.reduce((s, c) => s + c.totalBytes, 0)
  const uploadedBytes = categories.reduce((s, c) => s + c.uploadedBytes, 0)
  const percentDecimal = totalBytes ? uploadedBytes / totalBytes : 1
  const percent = `${(percentDecimal * 100).toFixed(1)}%`.padStart(6)
  return {
    total,
    remaining,
    uploaded,
    totalBytes,
    uploadedBytes,
    percent,
    percentDecimal,
  }
}

export async function queryUploadStats(
  db: DatabaseAdapter,
  indexerURL: string,
): Promise<UploadStats> {
  // Exclude pending imports (hash = '') — they have no size yet and are
  // shown separately in the "Pending import" row.
  const active = `f.trashedAt IS NULL AND f.deletedAt IS NULL AND f.hash != ''`
  const latestVersion = buildLatestVersionFilter('f')
  const q = (where: string) => queryStatsForWhere(db, where, indexerURL)

  const [photos, videos, audio, docs, other, thumbnails] = await Promise.all([
    q(
      `f.kind = 'file' AND ${active} AND f.type LIKE 'image/%' AND ${latestVersion}`,
    ),
    q(
      `f.kind = 'file' AND ${active} AND f.type LIKE 'video/%' AND ${latestVersion}`,
    ),
    q(
      `f.kind = 'file' AND ${active} AND f.type LIKE 'audio/%' AND ${latestVersion}`,
    ),
    q(
      `f.kind = 'file' AND ${active} AND (f.type LIKE 'text/%' OR f.type LIKE 'application/%') AND ${latestVersion}`,
    ),
    q(
      `f.kind = 'file' AND ${active} AND f.type NOT LIKE 'image/%' AND f.type NOT LIKE 'video/%' AND f.type NOT LIKE 'audio/%' AND f.type NOT LIKE 'text/%' AND f.type NOT LIKE 'application/%' AND ${latestVersion}`,
    ),
    q(`f.kind = 'thumb' AND ${active}`),
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
