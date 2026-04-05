import { uniqueId } from '@siastorage/core/lib/uniqueId'
import { logger } from '@siastorage/logger'
import RNFS from 'react-native-fs'
import { queueUploadForFileId } from '../managers/uploader'
import { app } from '../stores/appService'
import { copyFileToFs } from '../stores/fs'
import { getLogLevelSync, getLogScopesSync, readLogs } from '../stores/logs'
import { calculateContentHash } from './contentHash'

/** Export logs to a library file. */
export async function exportLogs(): Promise<string | null> {
  try {
    const logs = await readLogs(getLogLevelSync(), getLogScopesSync())
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
    const tempFilePath = `${RNFS.DocumentDirectoryPath}/${tempFileName}`
    await RNFS.writeFile(tempFilePath, content, 'utf8')

    const fileId = uniqueId()
    const size = new TextEncoder().encode(content).length
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `logs-${timestamp}.jsonl`

    // Copy temp file to FS storage.
    const fsFileUri = await copyFileToFs({ id: fileId, type: 'application/x-ndjson' }, tempFilePath)

    // Clean up temp file.
    await RNFS.unlink(tempFilePath)

    // Calculate hash.
    const hash = await calculateContentHash(fsFileUri)
    if (!hash) {
      throw new Error('Failed to calculate content hash')
    }

    // Check for duplicates.
    const existingFile = await app().files.getByContentHash(hash)
    if (existingFile) {
      return existingFile.id
    }

    // Create file record.
    const now = Date.now()
    await app().files.create({
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
