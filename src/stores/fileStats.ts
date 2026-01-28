import { db } from '../db'
import { getIndexerURL } from './settings'

export type UploadCategoryStats = {
  total: number
  remaining: number
  uploaded: number
  percent: string
  percentDecimal: number
}

export type UploadStats = {
  overall: UploadCategoryStats
  photos: UploadCategoryStats
  videos: UploadCategoryStats
  audio: UploadCategoryStats
  docs: UploadCategoryStats
  other: UploadCategoryStats
  thumbnails: UploadCategoryStats
}

async function counts(
  where: string,
  indexerURL: string,
): Promise<{
  total: number
  remaining: number
  uploaded: number
  percent: string
  percentDecimal: number
}> {
  const totalRow = await db().getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM files f WHERE ${where}`,
  )
  const remainingRow = await db().getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM files f
     WHERE ${where}
       AND NOT EXISTS (
         SELECT 1 FROM objects o
         WHERE o.fileId = f.id AND o.indexerURL = ?
       )`,
    indexerURL,
  )
  const total = totalRow?.count ?? 0
  const remaining = remainingRow?.count ?? 0
  const uploaded = Math.max(0, total - remaining)
  const percentDecimal = total ? uploaded / total : 1
  const percent = `${Math.round(percentDecimal * 100)}%`
  return { total, remaining, uploaded, percent, percentDecimal }
}

/** Get upload stats for the library with category breakdown. */
export async function getUploadStats(): Promise<UploadStats> {
  const indexerURL = await getIndexerURL()
  const photosWhere = `f.thumbForHash IS NULL AND f.type LIKE 'image/%'`
  const videosWhere = `f.thumbForHash IS NULL AND f.type LIKE 'video/%'`
  const audioWhere = `f.thumbForHash IS NULL AND f.type LIKE 'audio/%'`
  const docsWhere = `f.thumbForHash IS NULL AND (f.type LIKE 'text/%' OR f.type LIKE 'application/%')`
  const otherWhere = `f.thumbForHash IS NULL AND f.type NOT LIKE 'image/%' AND f.type NOT LIKE 'video/%' AND f.type NOT LIKE 'audio/%' AND f.type NOT LIKE 'text/%' AND f.type NOT LIKE 'application/%'`
  const thumbsWhere = `f.thumbForHash IS NOT NULL`

  const [photosC, videosC, audioC, docsC, otherC, thumbsC] = await Promise.all([
    counts(photosWhere, indexerURL),
    counts(videosWhere, indexerURL),
    counts(audioWhere, indexerURL),
    counts(docsWhere, indexerURL),
    counts(otherWhere, indexerURL),
    counts(thumbsWhere, indexerURL),
  ])

  const overallTotal =
    photosC.total +
    videosC.total +
    audioC.total +
    docsC.total +
    otherC.total +
    thumbsC.total
  const overallUploaded =
    photosC.uploaded +
    videosC.uploaded +
    audioC.uploaded +
    docsC.uploaded +
    otherC.uploaded +
    thumbsC.uploaded
  const overallRemaining =
    photosC.remaining +
    videosC.remaining +
    audioC.remaining +
    docsC.remaining +
    otherC.remaining +
    thumbsC.remaining
  const overallPercentDecimal = overallTotal
    ? overallUploaded / overallTotal
    : 1
  const overallPercent = `${Math.round(overallPercentDecimal * 100)}%`

  const stats: UploadStats = {
    overall: {
      uploaded: overallUploaded,
      total: overallTotal,
      remaining: overallRemaining,
      percent: overallPercent,
      percentDecimal: overallPercentDecimal,
    },
    photos: {
      uploaded: photosC.uploaded,
      total: photosC.total,
      remaining: photosC.remaining,
      percent: photosC.percent,
      percentDecimal: photosC.percentDecimal,
    },
    videos: {
      uploaded: videosC.uploaded,
      total: videosC.total,
      remaining: videosC.remaining,
      percent: videosC.percent,
      percentDecimal: videosC.percentDecimal,
    },
    audio: {
      uploaded: audioC.uploaded,
      total: audioC.total,
      remaining: audioC.remaining,
      percent: audioC.percent,
      percentDecimal: audioC.percentDecimal,
    },
    docs: {
      uploaded: docsC.uploaded,
      total: docsC.total,
      remaining: docsC.remaining,
      percent: docsC.percent,
      percentDecimal: docsC.percentDecimal,
    },
    other: {
      uploaded: otherC.uploaded,
      total: otherC.total,
      remaining: otherC.remaining,
      percent: otherC.percent,
      percentDecimal: otherC.percentDecimal,
    },
    thumbnails: {
      uploaded: thumbsC.uploaded,
      total: thumbsC.total,
      remaining: thumbsC.remaining,
      percent: thumbsC.percent,
      percentDecimal: thumbsC.percentDecimal,
    },
  }

  return stats
}
