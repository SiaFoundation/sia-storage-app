import { uniqueId } from '@siastorage/core/lib/uniqueId'
import { logger } from '@siastorage/logger'
import { File, Paths } from 'expo-file-system'
import { queueUploadForFileId } from '../managers/uploader'
import { createFileRecord, readFileRecordByContentHash } from '../stores/files'
import { copyFileToFs } from '../stores/fs'
import { readLogs, useLogsStore } from '../stores/logs'
import { calculateContentHash } from './contentHash'

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

    // Format logs as JSONL.
    const content = logs
      .map((entry) =>
        JSON.stringify({
          ...entry.data,
          ts: entry.timestamp,
          level: entry.level,
          scope: entry.scope,
          msg: entry.message,
        }),
      )
      .join('\n')

    // Write to temporary file.
    const tempFileName = `logs-export-${Date.now()}.jsonl`
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
    const fileName = `logs-${timestamp}.jsonl`

    // Copy temp file to FS storage.
    const fsFileUri = await copyFileToFs(
      { id: fileId, type: 'application/x-ndjson' },
      tempFile,
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
      type: 'application/x-ndjson',
      size,
      hash,
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      localId: null,
      kind: 'file',
      trashedAt: null,
      deletedAt: null,
      thumbForId: undefined,
      thumbSize: undefined,
    })

    queueUploadForFileId(fileId)

    return fileId
  } catch (error) {
    logger.error('logExport', 'export_failed', { error: error as Error })
    throw error
  }
}
