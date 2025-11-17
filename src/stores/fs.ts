import { Directory, File, Paths } from 'expo-file-system'
import * as MediaLibrary from 'expo-media-library'
import useSWR from 'swr'
import { extFromMime } from '../lib/fileTypes'
import { logger } from '../lib/logger'
import { buildSWRHelpers } from '../lib/swr'
import { db } from '../db'
import { sqlDelete, sqlInsert, sqlUpdate } from '../db/sql'

const { getKey, triggerChange } = buildSWRHelpers('fs/files')

export const FS_DIRECTORY = new Directory(Paths.document, 'files')

type FsFileInfo = {
  id: string
  type: string
  localId: string | null
}

export type FsMetaRow = {
  fileId: string
  uri: string
  size: number
  addedAt: number
  usedAt: number
}

export function fsGetDirectory(): Directory {
  return FS_DIRECTORY
}

export function fsTriggerRefresh(fileId?: string): Promise<void> {
  return triggerChange(fileId)
}

export function fsListFiles(): File[] {
  const info = FS_DIRECTORY.info()
  if (!info.exists) {
    return []
  }
  const entries = FS_DIRECTORY.list()
  return entries.filter((entry): entry is File => entry instanceof File)
}

export async function fsEnsureDir(): Promise<void> {
  const info = FS_DIRECTORY.info()
  if (!info.exists) {
    FS_DIRECTORY.create({ intermediates: true })
  }
}

function fsGetFileForId(file: FsFileInfo): File {
  return new File(FS_DIRECTORY, `${file.id}${extFromMime(file.type)}`)
}

export async function fsReadUri(file: FsFileInfo): Promise<string | null> {
  let mutated = false
  const existingMeta = await fsReadMeta(file.id)
  if (existingMeta) {
    const fsFile = new File(existingMeta.uri)
    const cachedInfo = fsFile.info()
    if (cachedInfo.exists) {
      void fsTouchUsedAt(file.id)
      return existingMeta.uri
    }
    await fsDeleteMeta(file.id)
    mutated = true
  }

  const fallbackFile = fsGetFileForId(file)
  const fallbackInfo = fallbackFile.info()
  if (fallbackInfo.exists) {
    const size = fallbackInfo.size ?? existingMeta?.size ?? 0
    await fsUpsertMeta({
      fileId: file.id,
      uri: fallbackFile.uri,
      size,
      addedAt: existingMeta?.addedAt ?? Date.now(),
      usedAt: Date.now(),
    })
    fsTriggerRefresh(file.id)
    return fallbackFile.uri
  }

  if (mutated) {
    fsTriggerRefresh(file.id)
  }
  return null
}

export async function fsRemoveFile(file: FsFileInfo): Promise<void> {
  const fsFile = fsGetFileForId(file)
  const info = fsFile.info()
  let mutated = false
  if (info.exists) {
    fsFile.delete()
    mutated = true
  }
  const meta = await fsReadMeta(file.id)
  if (meta) {
    await fsDeleteMeta(file.id)
    mutated = true
  }
  if (mutated) {
    fsTriggerRefresh(file.id)
  }
}

export async function fsCopyFile(
  file: FsFileInfo,
  sourceFile: File
): Promise<string> {
  logger.log(`[fs] copyFile ${file.id} from ${sourceFile.uri}`)
  await fsEnsureDir()
  const target = fsGetFileForId(file)
  const targetInfo = target.info()
  if (targetInfo.exists) {
    target.delete()
  }
  sourceFile.copy(target)
  const destinationInfo = target.info()
  const sourceInfo = sourceFile.info()
  const previous = await fsReadMeta(file.id)
  const size = destinationInfo.size ?? sourceInfo.size ?? previous?.size ?? 0
  await fsUpsertMeta({
    fileId: file.id,
    uri: target.uri,
    size,
    addedAt: previous?.addedAt ?? Date.now(),
    usedAt: Date.now(),
  })
  fsTriggerRefresh(file.id)
  return target.uri
}

export function useFsFileUri(file?: FsFileInfo) {
  return useSWR([...getKey(file?.id), 'uri'], () => {
    return file ? fsReadUri(file) : null
  })
}

const fsMetadataTable = 'fs'

export async function fsUpsertMeta(row: FsMetaRow): Promise<void> {
  await sqlInsert(
    fsMetadataTable,
    {
      fileId: row.fileId,
      uri: row.uri,
      size: row.size,
      addedAt: row.addedAt,
      usedAt: row.usedAt,
    },
    { conflictClause: 'OR REPLACE' }
  )
}

export async function fsDeleteMeta(fileId: string): Promise<void> {
  await sqlDelete(fsMetadataTable, { fileId })
}

export async function fsReadMeta(fileId: string): Promise<FsMetaRow | null> {
  return db().getFirstAsync<FsMetaRow>(
    `SELECT fileId, uri, size, addedAt, usedAt FROM ${fsMetadataTable} WHERE fileId = ?`,
    fileId
  )
}

export async function fsReadAllMeta(): Promise<FsMetaRow[]> {
  return db().getAllAsync<FsMetaRow>(
    `SELECT fileId, uri, size, addedAt, usedAt FROM ${fsMetadataTable}`
  )
}

export async function fsTouchUsedAt(
  fileId: string,
  usedAt: number = Date.now()
): Promise<void> {
  await sqlUpdate(fsMetadataTable, { usedAt }, { fileId })
}

export async function fsClearForTests(): Promise<void> {
  await sqlDelete(fsMetadataTable)
}
