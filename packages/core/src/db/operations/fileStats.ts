import type { DatabaseAdapter } from '../../adapters/db'

export type UploadCategoryStats = {
  total: number
  remaining: number
  uploaded: number
  totalBytes: number
  uploadedBytes: number
  percent: string
  percentDecimal: number
}

export async function queryUploadCategoryStats(
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
