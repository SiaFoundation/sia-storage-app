import type { UploadCategoryStats } from '@siastorage/core/db/operations'
import * as ops from '@siastorage/core/db/operations'
import { db } from '../db'
import { getIndexerURL } from './settings'

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

/** Get upload stats for the library with category breakdown. */
export async function getUploadStats(): Promise<UploadStats> {
  const indexerURL = await getIndexerURL()
  const active = `f.trashedAt IS NULL AND f.deletedAt IS NULL`
  const photosWhere = `f.kind = 'file' AND ${active} AND f.type LIKE 'image/%'`
  const videosWhere = `f.kind = 'file' AND ${active} AND f.type LIKE 'video/%'`
  const audioWhere = `f.kind = 'file' AND ${active} AND f.type LIKE 'audio/%'`
  const docsWhere = `f.kind = 'file' AND ${active} AND (f.type LIKE 'text/%' OR f.type LIKE 'application/%')`
  const otherWhere = `f.kind = 'file' AND ${active} AND f.type NOT LIKE 'image/%' AND f.type NOT LIKE 'video/%' AND f.type NOT LIKE 'audio/%' AND f.type NOT LIKE 'text/%' AND f.type NOT LIKE 'application/%'`
  const thumbsWhere = `f.kind = 'thumb' AND ${active}`

  const q = (where: string) =>
    ops.queryUploadCategoryStats(db(), where, indexerURL)
  const [photosC, videosC, audioC, docsC, otherC, thumbsC] = await Promise.all([
    q(photosWhere),
    q(videosWhere),
    q(audioWhere),
    q(docsWhere),
    q(otherWhere),
    q(thumbsWhere),
  ])

  const fileCategories = [photosC, videosC, audioC, docsC, otherC]
  const filesTotalCount = fileCategories.reduce((s, c) => s + c.total, 0)
  const filesUploaded = fileCategories.reduce((s, c) => s + c.uploaded, 0)
  const filesRemaining = fileCategories.reduce((s, c) => s + c.remaining, 0)
  const filesTotalBytes = fileCategories.reduce((s, c) => s + c.totalBytes, 0)
  const filesUploadedBytes = fileCategories.reduce(
    (s, c) => s + c.uploadedBytes,
    0,
  )
  const filesPercentDecimal = filesTotalBytes
    ? filesUploadedBytes / filesTotalBytes
    : 1
  const filesPercent = `${(filesPercentDecimal * 100).toFixed(1)}%`.padStart(6)

  const allCategories = [...fileCategories, thumbsC]
  const overallTotal = allCategories.reduce((s, c) => s + c.total, 0)
  const overallUploaded = allCategories.reduce((s, c) => s + c.uploaded, 0)
  const overallRemaining = allCategories.reduce((s, c) => s + c.remaining, 0)
  const overallTotalBytes = allCategories.reduce((s, c) => s + c.totalBytes, 0)
  const overallUploadedBytes = allCategories.reduce(
    (s, c) => s + c.uploadedBytes,
    0,
  )
  const overallPercentDecimal = overallTotalBytes
    ? overallUploadedBytes / overallTotalBytes
    : 1
  const overallPercent =
    `${(overallPercentDecimal * 100).toFixed(1)}%`.padStart(6)

  const stats: UploadStats = {
    overall: {
      uploaded: overallUploaded,
      total: overallTotal,
      remaining: overallRemaining,
      totalBytes: overallTotalBytes,
      uploadedBytes: overallUploadedBytes,
      percent: overallPercent,
      percentDecimal: overallPercentDecimal,
    },
    files: {
      uploaded: filesUploaded,
      total: filesTotalCount,
      remaining: filesRemaining,
      totalBytes: filesTotalBytes,
      uploadedBytes: filesUploadedBytes,
      percent: filesPercent,
      percentDecimal: filesPercentDecimal,
    },
    photos: photosC,
    videos: videosC,
    audio: audioC,
    docs: docsC,
    other: otherC,
    thumbnails: thumbsC,
  }

  return stats
}
