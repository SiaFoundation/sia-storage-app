import { File, Paths } from 'expo-file-system'
import { logger } from './logger'
import { readFileRecordByContentHash } from '../stores/files'
import { uniqueId } from './uniqueId'
import { calculateContentHash } from './contentHash'
import { copyFileToFs } from '../stores/fs'
import { createFileRecord } from '../stores/files'
import { queueUploadForFileId } from '../managers/uploader'
import { readLogs, useLogsStore } from '../stores/logs'

/** Export logs to a library file. */
export async function exportLogs(): Promise<string | null> {
  try {
    // Get current filter state.
    const state = useLogsStore.getState()
    // Read logs from database with current filters applied.
    const logs = await readLogs(state.logLevel, state.logScopes)
    if (logs.length === 0) {
      return null
    }

    // Format logs as text file.
    const content = logs
      .map(
        (entry) =>
          `${entry.timestamp} ${entry.level.toUpperCase()} [${entry.scope}] ${
            entry.message
          }`
      )
      .join('\n')

    // Write to temporary file.
    const tempFileName = `logs-export-${Date.now()}.txt`
    const tempFile = new File(Paths.document, tempFileName)
    const contentBytes = new TextEncoder().encode(content)

    // Create empty file first.
    tempFile.create({ intermediates: true })

    // Write content.
    const writer = tempFile.writableStream().getWriter()
    try {
      await writer.write(contentBytes)
    } finally {
      await writer.close()
    }

    const fileId = uniqueId()
    const size = contentBytes.length
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `logs-${timestamp}.txt`

    // Copy temp file to FS storage.
    const fsFileUri = await copyFileToFs(
      { id: fileId, type: 'text/plain' },
      tempFile
    )

    // Clean up temp file.
    tempFile.delete()

    // Calculate hash.
    const hash = await calculateContentHash(fsFileUri)
    if (!hash) {
      throw new Error('Failed to calculate content hash')
    }

    // Check for duplicates.
    const existingFile = await readFileRecordByContentHash(hash)
    if (existingFile) {
      return existingFile.id
    }

    // Create file record.
    const now = Date.now()
    await createFileRecord({
      id: fileId,
      name: fileName,
      type: 'text/plain',
      size,
      hash,
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: null,
      thumbForHash: undefined,
      thumbSize: undefined,
    })

    queueUploadForFileId(fileId)

    return fileId
  } catch (error) {
    logger.error('logExport', 'Failed to export logs', error)
    throw error
  }
}
