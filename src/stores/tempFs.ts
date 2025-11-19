import { Directory, File, Paths } from 'expo-file-system'

/**
 * Temporary file system used for in-progress file downloads.
 */

const tempFsStorageDirectory = new Directory(Paths.cache, 'files')

type TempFsFileInfo = {
  id: string
  type: string
  localId: string | null
}

export function ensureTempFsStorageDirectory(): void {
  const info = tempFsStorageDirectory.info()
  if (!info.exists) {
    tempFsStorageDirectory.create({ intermediates: true })
  }
}

function getTempDownloadFileForId(file: TempFsFileInfo): File {
  return new File(tempFsStorageDirectory, `${file.id}.download.tmp`)
}

export async function getOrCreateTempDownloadFile(
  file: TempFsFileInfo
): Promise<File> {
  const f = getTempDownloadFileForId(file)
  const info = f.info()
  if (!info.exists) {
    f.create({ intermediates: true })
  }
  return f
}

export async function removeTempDownloadFile(
  file: TempFsFileInfo
): Promise<void> {
  const f = getTempDownloadFileForId(file)
  const info = f.info()
  if (info.exists) {
    f.delete()
  }
}
