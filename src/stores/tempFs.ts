import { Directory, File, Paths } from 'expo-file-system'

const TEMP_FS_DIR = new Directory(Paths.cache, 'files')

type TempFsFileInfo = {
  id: string
  type: string
  localId: string | null
}

export function tempFsGetDirectory(): Directory {
  return TEMP_FS_DIR
}

export function tempFsListFiles(): File[] {
  const info = TEMP_FS_DIR.info()
  if (!info.exists) {
    return []
  }
  const entries = TEMP_FS_DIR.list()
  return entries.filter((entry): entry is File => entry instanceof File)
}

export async function tempFsEnsureDir(): Promise<void> {
  const info = TEMP_FS_DIR.info()
  if (!info.exists) {
    TEMP_FS_DIR.create({ intermediates: true })
  }
}

function tempFsGetFileForId(file: TempFsFileInfo): File {
  return new File(TEMP_FS_DIR, `${file.id}.tmp`)
}

function tempFsGetUploadFile(file: TempFsFileInfo): File {
  return new File(TEMP_FS_DIR, `${file.id}.upload.tmp`)
}

export async function tempFsGetUploadFileForId(
  file: TempFsFileInfo
): Promise<File> {
  await tempFsRemoveUploadFileForId(file)
  await tempFsEnsureDir()
  return tempFsGetUploadFile(file)
}

export async function tempFsRemoveUploadFileForId(
  file: TempFsFileInfo
): Promise<void> {
  const tmp = tempFsGetUploadFile(file)
  try {
    const exists = tmp.info().exists
    if (exists) {
      tmp.delete()
    }
  } catch {}
}

export async function tempFsGetOrCreateFile(
  file: TempFsFileInfo
): Promise<File> {
  await tempFsEnsureDir()
  const f = tempFsGetFileForId(file)
  const info = f.info()
  if (!info.exists) {
    f.create({ intermediates: true })
  }
  return f
}

export async function tempFsRemoveFile(file: TempFsFileInfo): Promise<void> {
  const f = tempFsGetFileForId(file)
  const info = f.info()
  if (info.exists) {
    f.delete()
  }
}
