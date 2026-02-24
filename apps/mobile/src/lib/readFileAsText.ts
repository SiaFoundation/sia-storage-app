import * as FS from 'expo-file-system/legacy'

export async function readFileAsText(uri: string): Promise<string> {
  const info = await FS.getInfoAsync(uri)
  if (!info.exists || info.isDirectory) {
    throw new Error('ENOENT: file not found')
  }
  return FS.readAsStringAsync(uri)
}
