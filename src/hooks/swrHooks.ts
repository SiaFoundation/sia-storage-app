import useSWR from 'swr'
import {
  readAllFileRecords,
  createFileRecord,
  updateFileRecord,
  deleteFileRecord,
  deleteAllFileRecords,
  type FileRecord,
  seedDB,
} from '../functions/fileDB'

const KEY = 'fileRecords'
const fetcher = () => readAllFileRecords()

export function useFileRecords() {
  const swr = useSWR(KEY, fetcher)
  return swr
}

// Mutations that revalidate
export function useFileRecordActions() {
  const { mutate } = useSWR(KEY, fetcher)
  return {
    create: async (fr: FileRecord) => {
      await createFileRecord(fr)
      await mutate()
    },
    update: async (fr: FileRecord) => {
      await updateFileRecord(fr)
      await mutate()
    },
    deleteOne: async (id: string) => {
      await deleteFileRecord(id)
      await mutate()
    },
    deleteAll: async () => {
      await deleteAllFileRecords()
      await mutate()
    },
    seedDB: async () => {
      await seedDB()
      await mutate()
    },
  }
}
