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
import useSWRInfinite from 'swr/infinite'

let listMutate: () => void = () => {}

const { getKey, triggerChange: _triggerChange } = buildSWRHelpers('db/files')

async function triggerChange() {
  _triggerChange()
  listMutate()
}

export type FileRecord = {
  id: string
  cid: string | null
  fileName: string | null
  fileSize: number | null
  createdAt: number
  fileType: string | null
  sealedObjects: Record<string, SealedObject>
}

export async function insertOrReplaceFileRecord(
  fileRecord: FileRecord,
  triggerUpdate: boolean = true
): Promise<void> {
  const { id, cid, fileName, fileSize, createdAt, fileType, sealedObjects } =
    fileRecord
  await db().runAsync(
    'INSERT OR REPLACE INTO files (id, cid, fileName, fileSize, createdAt, fileType) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    cid,
    fileName,
    fileSize,
    createdAt,
    fileType
  )
  await updateFileSealedObjects(id, sealedObjects, triggerUpdate)
  if (triggerUpdate) {
    await triggerChange()
  }
}

export async function insertOrReplaceManyFileRecords(
  files: FileRecord[]
): Promise<void> {
  await db().withTransactionAsync(async () => {
    for (const fr of files) {
      await insertOrReplaceFileRecord(fr, false)
    }
  })
  await triggerChange()
}

export async function readAllFileRecords(): Promise<FileRecord[]> {
  const rows = await db().getAllAsync<{
    id: string
    cid: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    fileType: string
    sealedObjects: string | null
  }>(
    'SELECT id, cid, fileName, fileSize, createdAt, fileType, sealedObjects FROM files ORDER BY createdAt DESC'
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
  query?: string
  limit?: number
  offset?: number
}

export async function readOrderedFileRecords(
  opts?: FileOrderParams
): Promise<FileRecord[]> {
  const {
    sortBy = 'DATE',
    sortDir,
    categories = [],
    query,
    limit,
    offset,
  } = opts ?? {}
  const dir: SortDir = sortDir ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

  const prefixes = categories.map((c) => CATEGORY_TO_PREFIX[c])
  const hasCategories = prefixes.length > 0
  const hasQuery = typeof query === 'string' && query.trim().length > 0

  const whereParts: string[] = []
  const params: (string | number | null)[] = []
  if (hasCategories) {
    whereParts.push(prefixes.map(() => 'fileType LIKE ?').join(' OR '))
    params.push(...prefixes.map((p) => `${p}%`))
  }
  if (hasQuery) {
    whereParts.push('fileName LIKE ? COLLATE NOCASE ESCAPE "\\"')
    const escaped = (query ?? '').replace(/[%_\\]/g, (m) => `\\${m}`)
    params.push(`%${escaped}%`)
  }
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : ''

  const orderExpr =
    sortBy === 'NAME'
      ? `(fileName IS NULL) ASC, fileName COLLATE NOCASE ${dir}, id ${dir}`
      : `createdAt ${dir}, id ${dir}`

  let pageClause = ''
  if (limit != null && offset != null) {
    pageClause = ` LIMIT ${limit | 0} OFFSET ${offset | 0}`
  }

  const rows = await db().getAllAsync<{
    id: string
    cid: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    fileType: string
    sealedObjects: string | null
  }>(
    `SELECT id, cid, fileName, fileSize, createdAt, fileType, sealedObjects
     FROM files
     ${where}
     ORDER BY ${orderExpr}${pageClause}`,
    ...params
  )

  return rows.map(transformRow)
}

export async function readFileRecordByCid(
  cid: string
): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<{
    id: string
    cid: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    fileType: string
    sealedObjects: string | null
  }>(
    `SELECT id, cid, fileName, fileSize, createdAt, fileType, sealedObjects FROM files WHERE cid = ?`,
    cid
  )
  return row ? transformRow(row) : null
}

export async function readFileRecordsByCid(
  cids: string[]
): Promise<FileRecord[]> {
  const rows = await db().getAllAsync<{
    id: string
    cid: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    fileType: string
    sealedObjects: string | null
  }>(
    `SELECT id, cid, fileName, fileSize, createdAt, fileType, sealedObjects FROM files WHERE cid IN (${cids
      .map(() => '?')
      .join(',')})`
  )
  return rows.map(transformRow)
}

export async function readFileRecord(id: string): Promise<FileRecord | null> {
  const row = await db().getFirstAsync<{
    id: string
    cid: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    fileType: string
    sealedObjects: string | null
  }>(
    'SELECT id, cid, fileName, fileSize, createdAt, fileType, sealedObjects FROM files WHERE id = ?',
    id
  )
  if (!row) {
    logger.log('[db] file not found', id)
    return null
  }
  return transformRow(row)
}

export async function updateFileRecord(fileRecord: FileRecord): Promise<void> {
  const { id, cid, fileName, fileSize, createdAt, fileType, sealedObjects } =
    fileRecord
  await db().runAsync(
    'UPDATE files SET cid = ?, fileName = ?, fileSize = ?, createdAt = ?, fileType = ? WHERE id = ?',
    cid,
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
}

export async function updateFileSealedObjects(
  id: string,
  sealedObjects: SealedObjectsMap,
  triggerUpdate: boolean = true
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
  if (triggerUpdate) {
    await triggerChange()
  }
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
  cid: string
  fileName: string | null
  fileSize: number | null
  createdAt: number
  fileType: string
  sealedObjects: string | null
}): FileRecord {
  const [sealedObjects] = deserializeSealedObjects(row.id, row.sealedObjects)
  return {
    id: row.id,
    cid: row.cid,
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

const PAGE_SIZE = 40

export function useFileList() {
  const { sortBy, sortDir, selectedCategories, searchQuery } = useFilesView()
  const sortingDir = sortDir ?? (sortBy === 'NAME' ? 'ASC' : 'DESC')

  const categories = Array.from(selectedCategories ?? new Set())
  const categoriesKey = categories.length
    ? categories.slice().sort().join(',')
    : ''

  const base = getKey(
    `list:${sortBy}:${sortingDir}:${categoriesKey}:${searchQuery ?? ''}`
  )

  const fetcher = async (key: string) => {
    const pageIndex = Number(key.split('|page=').pop() ?? '0')
    const items = await readOrderedFileRecords({
      sortBy,
      sortDir: sortingDir,
      categories: categories.length ? categories : undefined,
      query: searchQuery?.trim().length ? searchQuery : undefined,
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
    })
    return items
  }

  const swr = useSWRInfinite<FileRecord[]>(
    (pageIndex, prevPage) => {
      if (pageIndex > 0 && (!prevPage || prevPage.length < PAGE_SIZE))
        return null
      return `${base}|page=${pageIndex}`
    },
    fetcher,
    { revalidateOnFocus: false, revalidateAll: true }
  )

  listMutate = swr.mutate

  const pages = swr.data
  const flat = pages ? pages.flat() : undefined

  const lastPage = pages?.[pages.length - 1]
  const hasMore = !!lastPage && lastPage.length === PAGE_SIZE

  return {
    ...swr,
    data: flat,
    hasMore,
  }
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

// File View Store
export type SortBy = 'NAME' | 'DATE'
export type SortDir = 'ASC' | 'DESC'
export type Category = 'Video' | 'Image' | 'Audio' | 'Files'

type FilesViewState = {
  sortBy: SortBy
  sortDir: SortDir
  selectedCategories: Set<Category>
  searchQuery: string
}

export const useFilesView = create<FilesViewState>(() => ({
  sortBy: 'DATE',
  sortDir: 'DESC',
  selectedCategories: new Set<Category>(),
  searchQuery: '',
}))

const { setState } = useFilesView

export function setSortCategory(sortBy: SortBy) {
  setState(() => {
    return { sortBy }
  })
}

export function toggleDir() {
  setState((state) => {
    return { sortDir: state.sortDir === 'ASC' ? 'DESC' : 'ASC' }
  })
}

export function toggleCategory(c: Category) {
  setState((state) => {
    const next = new Set(state.selectedCategories)
    next.has(c) ? next.delete(c) : next.add(c)
    return { selectedCategories: next }
  })
}

export function clearCategories() {
  setState(() => {
    return { selectedCategories: new Set() }
  })
}

export function setSearchQuery(searchQuery: string) {
  setState(() => {
    return { searchQuery }
  })
}

export function clearSearchQuery() {
  setState(() => {
    return { searchQuery: '' }
  })
}
