import type { UploadEntry } from '../app/stores'

/**
 * What a status line says about uploads, on the desktop and on a phone.
 *
 * The uploads store holds the files the uploader has taken: queued, packing,
 * sending, or failed and waiting to be tried again. A file on the device with
 * no copy on the network is outside it between polls and until the poll
 * reaches it in a large backlog. A status built from the store alone reads as
 * finished while such files wait, so the count of files waiting also takes
 * the library's count of files with no copy on the network.
 *
 * A thumbnail uploads as an object of its own, so it keeps an upload in
 * flight and moves its progress, but the counts a person reads are of files.
 */
export type Uploads = {
  /** Entries being packed or sent, thumbnails included. */
  active: number
  activeFiles: number
  activeFileBytes: number
  /** Entries registered and not yet picked up, thumbnails included. */
  queued: number
  queuedFiles: number
  /** 0..1 across every active entry, weighted by size. */
  progress: number
}

export const NO_UPLOADS: Uploads = {
  active: 0,
  activeFiles: 0,
  activeFileBytes: 0,
  queued: 0,
  queuedFiles: 0,
  progress: 0,
}

export function summarizeUploads(entries: UploadEntry[]): Uploads {
  const summary = { ...NO_UPLOADS }
  let bytes = 0
  let sent = 0
  for (const entry of entries) {
    const isFile = entry.kind !== 'thumb'
    if (entry.status === 'queued') {
      summary.queued += 1
      if (isFile) summary.queuedFiles += 1
    } else if (
      entry.status === 'packing' ||
      entry.status === 'packed' ||
      entry.status === 'uploading'
    ) {
      summary.active += 1
      bytes += entry.size
      sent += entry.progress * entry.size
      if (isFile) {
        summary.activeFiles += 1
        summary.activeFileBytes += entry.size
      }
    }
  }
  summary.progress = bytes > 0 ? sent / bytes : 0
  return summary
}

/**
 * Files waiting to upload: queued, or on the device with no copy on the
 * network and not being sent. `filesNotUploaded` counts current, untrashed
 * files only, the ones the uploader takes, and includes the files in flight.
 * The two counts are read at different moments, so neither bounds the other.
 */
export function filesWaitingToUpload(uploads: Uploads, filesNotUploaded: number): number {
  return Math.max(uploads.queuedFiles, filesNotUploaded - uploads.activeFiles, 0)
}
