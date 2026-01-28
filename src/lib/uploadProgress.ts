/**
 * Calculate individual file progress from batch progress.
 *
 * All files in a batch show the same progress as the batch itself.
 * This is because files are packed into slabs together - if the upload
 * is canceled, ALL files in the slab fail, not just some of them.
 * Therefore it would be misleading to show individual files as "complete"
 * before the entire slab upload is finished.
 */
export type BatchFile = {
  fileId: string
  size: number
}

export type BatchInfo = {
  files: BatchFile[]
  totalSize: number
}

/**
 * Calculate the progress (0-1) for a specific file in a batch
 * based on the overall batch progress.
 *
 * All files in the same batch return the same progress value because
 * they are packed together and succeed or fail as a unit.
 */
export function calculateFileProgress(
  batch: BatchInfo,
  batchProgress: number,
  fileId: string,
): number {
  // Verify the file exists in the batch
  const fileExists = batch.files.some((f) => f.fileId === fileId)
  if (!fileExists) return 0

  // All files in a batch share the same progress
  return batchProgress
}

/**
 * Calculate progress for all files in a batch.
 * All files return the same batch progress value.
 */
export function calculateAllFileProgress(
  batch: BatchInfo,
  batchProgress: number,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const file of batch.files) {
    result[file.fileId] = batchProgress
  }
  return result
}
