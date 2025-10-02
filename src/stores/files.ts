import { SealedObject } from 'react-native-sia'
import {
  deserializeSealedObjects,
  SealedObjectsMap,
  serializeSealedObjects,
} from '../encoding/sealedObjects'
import { logger } from '../lib/logger'
import { db } from '../db'
import useSWR from 'swr'
import { fileHasASealedObject } from '../lib/file'
import { createGetterAndSWRHook } from '../lib/selectors'
import { buildSWRHelpers } from '../lib/swr'
import { create } from 'zustand'

const { getKey, triggerChange } = buildSWRHelpers('db/files')

export type FileRecord = {
  id: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  fileType: string | null
  sealedObjects: Record<string, SealedObject>
}

export async function createFileRecord(
  fileRecord: FileRecord,
  triggerUpdate: boolean = true
): Promise<void> {
  const { id, fileName, fileSize, createdAt, fileType, sealedObjects } =
    fileRecord
  await db().runAsync(
    'INSERT OR REPLACE INTO files (id, fileName, fileSize, createdAt, fileType) VALUES (?, ?, ?, ?, ?)',
    id,
    fileName,
    fileSize,
    createdAt,
    fileType
  )
  await updateFileSealedObjects(id, sealedObjects)
  if (triggerUpdate) {
    await triggerChange()
  }
}

export async function createManyFileRecords(
  files: FileRecord[]
): Promise<void> {
  await db().withTransactionAsync(async () => {
    for (const fr of files) {
      await createFileRecord(fr, false)
    }
  })
  await triggerChange()
}

export async function readAllFileRecords(): Promise<FileRecord[]> {
  const rows = await db().getAllAsync<{
    id: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    fileType: string
    sealedObjects: string | null
  }>(
    'SELECT id, fileName, fileSize, createdAt, fileType, sealedObjects FROM files ORDER BY createdAt DESC'
  )
  return rows.map(transformRow)
}

export async function readAllFileRecordsCount(): Promise<number> {
  const rows = await db().getFirstAsync<{
    count: number
  }>('SELECT COUNT(*) as count FROM files')
  return rows?.count ?? 0
}

const CATEGORY_TO_PREFIX: Record<Category, string> = {
  Video: 'video/',
  Image: 'image/',
  Audio: 'audio/',
  Files: 'application/',
}

export type FileOrderParams = {
  sortBy?: SortBy
  sortDir?: SortDir
  categories?: Category[]
}

export async function readOrderedFileRecords(
  opts?: FileOrderParams
): Promise<FileRecord[]> {
  const { sortBy = 'DATE', sortDir, categories = [] } = opts ?? {}
  const dir: SortDir = sortDir ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

  const prefixes = categories.map((c) => CATEGORY_TO_PREFIX[c]).filter(Boolean)

  const whereParts: string[] = []
  const params: any[] = []

  if (prefixes.length) {
    for (const p of prefixes) {
      whereParts.push(`fileType LIKE ?`)
      params.push(`${p}%`)
    }
  }

  const where = whereParts.length ? `WHERE (${whereParts.join(' OR ')})` : ''

  const orderExpr =
    sortBy === 'NAME'
      ? `fileName IS NULL, fileName COLLATE NOCASE ${dir}`
      : `createdAt ${dir}`

  const rows = await db().getAllAsync<{
    id: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    fileType: string
    sealedObjects: string | null
  }>(
    `SELECT id, fileName, fileSize, createdAt, fileType, sealedObjects
     FROM files
     ${where}
     ORDER BY ${orderExpr}`,
    ...params
  )

  return rows.map(transformRow)
}

export async function readFileRecord(id: string): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<{
    id: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    fileType: string
    sealedObjects: string | null
  }>(
    'SELECT id, fileName, fileSize, createdAt, fileType, sealedObjects FROM files WHERE id = ?',
    id
  )
  if (!row) {
    logger.log('[db] file not found', id)
    return null
  }
  return transformRow(row)
}

export async function updateFileRecord(fileRecord: FileRecord): Promise<void> {
  const { id, fileName, fileSize, createdAt, fileType, sealedObjects } =
    fileRecord
  await db().runAsync(
    'UPDATE files SET fileName = ?, fileSize = ?, createdAt = ?, fileType = ? WHERE id = ?',
    fileName,
    fileSize,
    createdAt,
    fileType,
    id
  )
  await updateFileSealedObjects(id, sealedObjects)
  await triggerChange()
}

export async function deleteFileRecord(id: string): Promise<void> {
  await db().runAsync('DELETE FROM files WHERE id = ?', id)
  await triggerChange()
}

export async function deleteAllFileRecords(): Promise<void> {
  await db().runAsync('DELETE FROM files')
  await triggerChange()
}

export async function updateFileSealedObjects(
  id: string,
  sealedObjects: SealedObjectsMap
): Promise<void> {
  const [serializedSealedObjects, error] = serializeSealedObjects(sealedObjects)
  if (error) {
    logger.log('[db] error serializing sealed objects, skipping update', error)
    return
  }
  await db().runAsync(
    'UPDATE files SET sealedObjects = ? WHERE id = ?',
    serializedSealedObjects,
    id
  )
  await triggerChange()
}

export async function updateFileSealedObject(
  id: string,
  indexerURL: string,
  sealedObject: SealedObject
): Promise<void> {
  const file = await readFileRecord(id)
  if (file == null) {
    logger.log('[db] file not found', id)
    return
  }
  const pos = file.sealedObjects ?? {}
  pos[indexerURL] = sealedObject
  const [serializedSealedObjects, error] = serializeSealedObjects(pos)
  if (error) {
    logger.log('[db] error serializing sealed objects, skipping update', error)
    return
  }
  await db().runAsync(
    'UPDATE files SET sealedObjects = ? WHERE id = ?',
    serializedSealedObjects,
    id
  )
  await triggerChange()
}

function transformRow(row: {
  id: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  fileType: string
  sealedObjects: string | null
}): FileRecord {
  const [sealedObjects] = deserializeSealedObjects(row.id, row.sealedObjects)
  return {
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize,
    createdAt: row.createdAt,
    fileType: row.fileType,
    sealedObjects: sealedObjects ?? {},
  }
}

export function useFileCount() {
  return useSWR(getKey('count'), () => readAllFileRecordsCount())
}

export function useFileList() {
  const { sortBy, sortDir, selectedCategories } = useFilesView()
  const dir = sortDir ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

  const cats = Array.from(selectedCategories ?? new Set())
  const catsKey = cats.length ? cats.slice().sort().join(',') : ''

  const key = getKey(`list:${sortBy}:${dir}:${catsKey}`)

  return useSWR(key, () =>
    readOrderedFileRecords({
      sortBy,
      sortDir: dir,
      categories: cats.length ? cats : undefined,
    })
  )
}

export function useFileCountAll() {
  return useSWR(getKey('count'), () =>
    readAllFileRecords().then((f) => f.length)
  )
}

export const [getFilesLocalOnly, useFilesLocalOnly] = createGetterAndSWRHook(
  getKey('localOnly'),
  async () => {
    const files = await readAllFileRecords()
    return files.filter((f) => !fileHasASealedObject(f))
  }
)

export const [getFileCountLocalOnly, useFileCountLocalOnly] =
  createGetterAndSWRHook(getKey('localOnlyCount'), async () => {
    const files = await getFilesLocalOnly()
    return files.length
  })

export function useFileDetails(id: string) {
  return useSWR(getKey(id), () => readFileRecord(id))
}

export type SortBy = 'NAME' | 'DATE'
export type SortDir = 'ASC' | 'DESC'
export type Category = 'Video' | 'Image' | 'Audio' | 'Files'

type FilesViewState = {
  sortBy: SortBy
  sortDir: SortDir
  selectedCategories: Set<Category>
  setSortCategory: (by: SortBy) => void
  toggleDir: () => void
  toggleCategory: (c: Category) => void
  clearCategories: () => void
}

export const useFilesView = create<FilesViewState>((set, get) => ({
  sortBy: 'DATE',
  sortDir: 'DESC',
  selectedCategories: new Set<Category>(),
  setSortCategory: (sortBy) =>
    set({ sortBy, sortDir: sortBy === 'NAME' ? 'ASC' : 'DESC' }),
  toggleDir: () => set({ sortDir: get().sortDir === 'ASC' ? 'DESC' : 'ASC' }),
  toggleCategory: (c) => {
    const next = new Set(get().selectedCategories)
    next.has(c) ? next.delete(c) : next.add(c)
    set({ selectedCategories: next })
  },
  clearCategories: () => set({ selectedCategories: new Set() }),
}))
