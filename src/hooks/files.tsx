import { readAllFileRecords, readFileRecord } from '../db/files'
import useSWR, { mutate } from 'swr'

const KEY = 'db/files'

const getKey = (id?: string) => {
  return id ? `${KEY}/${id}` : `${KEY}`
}

export function triggerFileListUpdate() {
  return mutate((key: string) => {
    return typeof key === 'string' && key.startsWith(getKey())
  })
}

export function useFileList() {
  return useSWR(getKey(), readAllFileRecords)
}

export function useFileDetails(id: string) {
  return useSWR(getKey(id), () => readFileRecord(id))
}
