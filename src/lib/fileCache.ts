import { Directory, File, Paths } from 'expo-file-system'
import useSWR, { mutate } from 'swr'
import { logger } from './settingsContext'
import { Ext } from './fileTypes'
import { FileRecord, readFileRecord, updateFileRecord } from '../db/files'
import { updateDownloadProgress } from './downloadState'

const CACHE_DIR = new Directory(Paths.cache, 'files-cache')

async function ensureCacheDir(): Promise<void> {
  const info = CACHE_DIR.info()
  if (!info.exists) {
    CACHE_DIR.create({ intermediates: true })
  }
}

export async function getCachedFileForId(id: string, ext: Ext): Promise<File> {
  await ensureCacheDir()
  return new File(CACHE_DIR, `${id}${ext}`)
}

export async function getOrCreateCachedFile(
  id: string,
  ext: Ext
): Promise<File> {
  const f = await getCachedFileForId(id, ext)
  const info = f.info()
  if (!info.exists) {
    f.create({ intermediates: true })
  }
  return f
}

export async function getCachedPathForId(
  id: string,
  ext: Ext
): Promise<string> {
  const f = await getCachedFileForId(id, ext)
  return f.uri
}

export async function isFileCached(id: string, ext: Ext): Promise<boolean> {
  const f = await getCachedFileForId(id, ext)
  const info = f.info()
  return info.exists === true
}

export async function removeFromCache(id: string, ext: Ext): Promise<void> {
  const f = await getCachedFileForId(id, ext)
  const info = f.info()
  if (info.exists) {
    f.delete()
  }
  mutate(`fileCache/${id}`)
}

export function refreshCache(id: string): void {
  mutate(`fileCache/${id}`)
}

export async function readCachedUri(
  id: string,
  ext: Ext
): Promise<string | null> {
  const f = await getCachedFileForId(id, ext)
  const info = f.info()
  return info.exists ? f.uri : null
}

export async function writeToCache(
  id: string,
  data: ArrayBuffer,
  ext: Ext
): Promise<string> {
  logger.log('writeToCache', id)
  await ensureCacheDir()
  const f = await getOrCreateCachedFile(id, ext)
  const writer = f.writableStream().getWriter()
  await writer.write(new Uint8Array(data))
  await writer.close()
  mutate(`fileCache/${id}`)
  return f.uri
}

export async function copyUriToCache(
  id: string,
  sourceUri: string,
  ext: Ext
): Promise<string> {
  logger.log('copyUriToCache', id, sourceUri)
  await ensureCacheDir()
  const f = await getOrCreateCachedFile(id, ext)
  const exists = f.info().exists
  if (exists) f.delete()
  const srcFile = new File(sourceUri)
  srcFile.copy(f)
  mutate(`fileCache/${id}`)
  return f.uri
}

export async function copyFileToCache(
  id: string,
  sourceFile: File,
  ext: Ext
): Promise<string> {
  logger.log('copyFileToCache', id, sourceFile.uri)
  await ensureCacheDir()
  const f = await getOrCreateCachedFile(id, ext)
  const exists = f.info().exists
  if (exists) f.delete()
  sourceFile.copy(f)
  mutate(`fileCache/${id}`)
  return f.uri
}

export function useCachedUri(id: string, ext: Ext) {
  return useSWR(`fileCache/${id}`, () => readCachedUri(id, ext))
}
