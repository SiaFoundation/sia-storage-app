import { AppProvider } from '@siastorage/core/app'
import { renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { initializeDB, resetDb } from '../db'
import { app } from './appService'
import { useUploadProgress } from './uploads'

function wrapper({ children }: { children: ReactNode }) {
  return <AppProvider value={app()}>{children}</AppProvider>
}

describe('useUploadProgress', () => {
  beforeEach(async () => {
    await initializeDB()
  })

  afterEach(async () => {
    app().uploads.clear()
    await resetDb()
    jest.clearAllMocks()
  })

  test('excludes thumbnails from the active file count', async () => {
    app().uploads.register({
      id: 'photo',
      size: 1000,
      kind: 'file',
      status: 'uploading',
      progress: 0,
    })
    app().uploads.register({
      id: 'thumb-512',
      size: 50,
      kind: 'thumb',
      status: 'uploading',
      progress: 0,
    })
    app().uploads.register({
      id: 'thumb-64',
      size: 10,
      kind: 'thumb',
      status: 'uploading',
      progress: 0,
    })

    const { result } = renderHook(() => useUploadProgress(), { wrapper })

    await waitFor(() => expect(result.current.packerCount).toBe(3))
    // Total stays at 3 (all three still upload); the user-facing count is just
    // the one real file.
    expect(result.current.packerFileCount).toBe(1)
  })

  test('counts an upload with no kind as a real file', async () => {
    app().uploads.register({ id: 'legacy', size: 1000, status: 'uploading', progress: 0 })

    const { result } = renderHook(() => useUploadProgress(), { wrapper })

    await waitFor(() => expect(result.current.packerCount).toBe(1))
    expect(result.current.packerFileCount).toBe(1)
  })
})
