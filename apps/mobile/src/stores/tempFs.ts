import { Directory, File, Paths } from 'expo-file-system'
import RNFS from 'react-native-fs'

/**
 * Temporary file system used for in-progress file downloads.
 */

const tempFsStorageDirectory = new Directory(Paths.cache, 'files')

type TempFsFileInfo = {
  id: string
  type: string
  localId: string | null
}

export async function ensureTempFsStorageDirectory(): Promise<void> {
  const exists = await RNFS.exists(tempFsStorageDirectory.uri)
  if (!exists) {
    await RNFS.mkdir(tempFsStorageDirectory.uri)
  }
}

function getTempDownloadFileForId(file: TempFsFileInfo): File {
  return new File(tempFsStorageDirectory, `${file.id}.download.tmp`)
}

export async function getOrCreateTempDownloadFile(
  file: TempFsFileInfo,
): Promise<File> {
  const f = getTempDownloadFileForId(file)
  const exists = await RNFS.exists(f.uri)
  if (!exists) {
    await RNFS.mkdir(tempFsStorageDirectory.uri)
    await RNFS.writeFile(f.uri, '')
  }
  return f
}

export async function removeTempDownloadFile(
  file: TempFsFileInfo,
): Promise<void> {
  const f = getTempDownloadFileForId(file)
  try {
    await RNFS.unlink(f.uri)
  } catch {
    // File does not exist, nothing to delete.
  }
}
