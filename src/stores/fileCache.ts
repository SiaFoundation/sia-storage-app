import { Directory, File, Paths } from 'expo-file-system'
import * as MediaLibrary from 'expo-media-library'
import useSWR from 'swr'
import { extFromMime } from '../lib/fileTypes'
import { logger } from '../lib/logger'
import { buildSWRHelpers } from '../lib/swr'

const { getKey, triggerChange } = buildSWRHelpers('cache/files')

const CACHE_DIR = new Directory(Paths.cache, 'files-cache')

export async function ensureCacheDir(): Promise<void> {
  const info = CACHE_DIR.info()
  if (!info.exists) {
    CACHE_DIR.create({ intermediates: true })
  }
}

async function getCacheFileForId(file: {
  id: string
  fileType: string | null
}): Promise<File> {
  return new File(CACHE_DIR, `${file.id}${extFromMime(file.fileType)}`)
}

async function getCacheTmpFileForId(file: { id: string }): Promise<File> {
  return new File(CACHE_DIR, `${file.id}.tmp`)
}

export async function getOrCreateCacheFile(file: {
  id: string
  fileType: string | null
}): Promise<File> {
  const f = await getCacheFileForId(file)
  const info = f.info()
  if (!info.exists) {
    f.create({ intermediates: true })
  }
  return f
}

export async function getOrCreateCacheTmpFile(file: {
  id: string
}): Promise<File> {
  const f = await getCacheTmpFileForId(file)
  const info = f.info()
  if (!info.exists) {
    f.create({ intermediates: true })
  }
  return f
}

export async function removeFileFromCache(file: {
  id: string
  fileType: string | null
}): Promise<void> {
  const f = await getCacheFileForId(file)
  const info = f.info()
  if (info.exists) {
    f.delete()
  }
  triggerChange(file.id)
}

export async function removeTmpFileFromCache(file: {
  id: string
}): Promise<void> {
  const f = await getCacheTmpFileForId(file)
  const info = f.info()
  if (info.exists) {
    f.delete()
  }
}

async function readCacheUri(file: {
  id: string
  fileType: string | null
}): Promise<string | null> {
  const f = await getCacheFileForId(file)
  const info = f.info()
  return info.exists ? f.uri : null
}

export async function copyFileToCache(
  file: {
    id: string
    fileType: string | null
  },
  sourceFile: File
): Promise<string> {
  logger.log('copyFileToCache', file.id, sourceFile.uri)
  const f = await getOrCreateCacheFile(file)
  const exists = f.info().exists
  if (exists) f.delete()
  sourceFile.copy(f)
  triggerChange(file.id)
  return f.uri
}

/**
 * Get the local URI for a file record. If the file has a local ID, use the
 * local URI from the MediaLibrary. The media may need to be downloaded from
 * the network if it is not already cached.
 */
export async function getLocalUri(
  localId: string | null
): Promise<string | null> {
  if (!localId) return null
  try {
    const asset = await MediaLibrary.getAssetInfoAsync(localId, {
      shouldDownloadFromNetwork: true,
    })
    return asset.localUri ?? null
  } catch (e) {
    return null
  }
}

/**
 * Get the URI for a file record. If the file has a local ID, use the local
 * URI from the MediaLibrary. Otherwise, check the file cache.
 */
export async function getFileUri(file: {
  id: string
  fileType: string | null
  localId?: string | null
}): Promise<string | null> {
  if (file.localId) {
    const localUri = await getLocalUri(file.localId)
    if (localUri) {
      return localUri
    }
  }
  return await readCacheUri(file)
}

/**
 * Get the URI for a file record. If the file has a local ID, use the local
 * URI from the MediaLibrary. Otherwise, check the file cache.
 */
export function useFileUri(file?: {
  id: string
  fileType: string | null
  localId?: string | null
}) {
  return useSWR([...getKey(file?.id), file?.localId], () => {
    return file ? getFileUri(file) : null
  })
}
