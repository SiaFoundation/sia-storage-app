import { FS_SCANNER_INTERVAL } from '../config'
import { logger } from '../lib/logger'
import { createServiceInterval } from '../lib/serviceInterval'
import {
  fsDeleteMeta,
  fsReadAllMeta,
  fsUpsertMeta,
  fsListFiles,
  fsTriggerRefresh,
} from '../stores/fs'

type FsReadEntry = {
  size: number
  uri: string
}

function parseFsFileName(name: string): {
  fileId: string | null
  isTemporary: boolean
} {
  const uploadTmpSuffix = '.upload.tmp'
  if (name.endsWith(uploadTmpSuffix)) {
    return {
      fileId: name.slice(0, -uploadTmpSuffix.length),
      isTemporary: true,
    }
  }
  const tmpSuffix = '.tmp'
  if (name.endsWith(tmpSuffix)) {
    return {
      fileId: name.slice(0, -tmpSuffix.length),
      isTemporary: true,
    }
  }
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) {
    return { fileId: name || null, isTemporary: false }
  }
  return {
    fileId: name.slice(0, dotIndex) || null,
    isTemporary: false,
  }
}

export async function runFsScanner(): Promise<void> {
  try {
    const readEntries = new Map<string, FsReadEntry>()
    for (const file of fsListFiles()) {
      const { fileId, isTemporary } = parseFsFileName(file.name)
      if (!fileId || isTemporary) {
        continue
      }
      const info = file.info()
      if (!info.exists) {
        continue
      }
      const size = info.size ?? 0
      const existing = readEntries.get(fileId)
      if (!existing) {
        readEntries.set(fileId, { size, uri: file.uri })
      } else if (existing.uri !== file.uri || existing.size !== size) {
        readEntries.set(fileId, { size, uri: file.uri })
      }
    }

    const metadataRows = await fsReadAllMeta()
    let mutated = false

    for (const row of metadataRows) {
      const disk = readEntries.get(row.fileId)
      if (!disk) {
        await fsDeleteMeta(row.fileId)
        mutated = true
        continue
      }

      if (disk.uri !== row.uri || disk.size !== row.size) {
        await fsUpsertMeta({
          fileId: row.fileId,
          uri: disk.uri,
          size: disk.size,
          addedAt: row.addedAt,
          usedAt: row.usedAt,
        })
        mutated = true
      }
      readEntries.delete(row.fileId)
    }

    if (readEntries.size > 0) {
      const timestamp = Date.now()
      for (const [fileId, disk] of readEntries) {
        await fsUpsertMeta({
          fileId,
          uri: disk.uri,
          size: disk.size,
          addedAt: timestamp,
          usedAt: timestamp,
        })
        mutated = true
      }
    }

    if (mutated) {
      await fsTriggerRefresh()
    }
  } catch (error) {
    logger.log('[fsScanner] error during scan', error)
  }
}

export const initFsScanner = createServiceInterval({
  name: 'fsScanner',
  worker: runFsScanner,
  getState: async () => true,
  interval: FS_SCANNER_INTERVAL,
})
