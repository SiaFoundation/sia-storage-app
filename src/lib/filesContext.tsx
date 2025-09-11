import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  initFileDB,
  readAllFileRecords,
  readFileRecord,
  createFileRecord,
  updateFileRecord,
  deleteFileRecord,
  deleteAllFileRecords,
  type FileRecord,
  createManyFileRecords,
} from '../db/files'
import useSWR, { mutate } from 'swr'
import { useCallback } from 'react'

type FilesContextValue = {
  createFile: (fr: FileRecord) => Promise<void>
  createManyFiles: (frs: FileRecord[]) => Promise<void>
  updateFile: (fr: FileRecord) => Promise<void>
  deleteFile: (id: string) => Promise<void>
  deleteAllFiles: () => Promise<void>
}

const FilesContext = createContext<FilesContextValue | undefined>(undefined)

export function FilesProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    ;(async () => {
      await initFileDB()
      setReady(true)
    })()
  }, [])

  const refetch = useCallback(() => {
    mutate((key: string) => {
      if (typeof key === 'string' && key.startsWith(KEY)) return key
    })
  }, [])

  const createFile = useCallback(
    async (fr: FileRecord) => {
      await createFileRecord(fr)
      refetch()
    },
    [refetch]
  )
  const createManyFiles = useCallback(
    async (frs: FileRecord[]) => {
      await createManyFileRecords(frs)
      refetch()
    },
    [refetch]
  )
  const updateFile = useCallback(
    async (fr: FileRecord) => {
      await updateFileRecord(fr)
      refetch()
    },
    [refetch]
  )
  const deleteFile = useCallback(
    async (id: string) => {
      await deleteFileRecord(id)
      refetch()
    },
    [refetch]
  )
  const deleteAllFiles = useCallback(async () => {
    await deleteAllFileRecords()
    refetch()
  }, [refetch])

  const value = useMemo<FilesContextValue>(
    () => ({
      createFile,
      createManyFiles,
      updateFile,
      deleteFile,
      deleteAllFiles,
    }),
    []
  )

  if (!ready) return null
  return <FilesContext.Provider value={value}>{children}</FilesContext.Provider>
}

export function useFiles(): FilesContextValue {
  const ctx = useContext(FilesContext)
  if (!ctx) throw new Error('FilesContext is not available.')
  return ctx
}

const KEY = 'db/files'

export function useFileList() {
  return useSWR(KEY, readAllFileRecords)
}

export function useFileDetails(id: string) {
  return useSWR(`${KEY}/${id}`, () => readFileRecord(id))
}
