import useSWR from 'swr'
import {
  readAllFileRecords,
  createFileRecord,
  updateFileRecord,
  deleteFileRecord,
  deleteAllFileRecords,
  FileRecord,
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
    create: async (fr: Omit<FileRecord, 'id'>) => {
      await createFileRecord(fr)
      await mutate()
    },
    update: async (fr: FileRecord) => {
      await updateFileRecord(fr)
      await mutate()
    },
    deleteOne: async (id: number) => {
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
