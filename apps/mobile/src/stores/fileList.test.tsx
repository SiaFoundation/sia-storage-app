import { AppProvider } from '@siastorage/core/app'
import type { LibraryQueryParams } from '@siastorage/core/db/operations'
import { type FileListParams, useFileList, useLoadMore } from '@siastorage/core/stores'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { initializeDB, resetDb } from '../db'
import { app } from './appService'

// SWR's own retry is off, as it is for a load that fails while the app is in
// the background, where SWR is paused and drops the failure. Its dedupe and
// slow-load timers are off so none outlives the test.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <AppProvider value={app()}>
      <SWRConfig
        value={{
          provider: () => new Map(),
          shouldRetryOnError: false,
          dedupingInterval: 0,
          loadingTimeout: 0,
        }}
      >
        {children}
      </SWRConfig>
    </AppProvider>
  )
}

function useGrid(params: FileListParams = { scope: 'grid-test' }) {
  const list = useFileList(params)
  return { files: list.data, isValidating: list.isValidating, ...useLoadMore(list) }
}

async function createFile(id: string, createdAt: number) {
  await app().files.create({
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    kind: 'file',
    size: 100,
    hash: `sha256:hash-${id}` as const,
    createdAt,
    updatedAt: createdAt,
    mediaAssetId: null,
    addedAt: createdAt,
    trashedAt: null,
    deletedAt: null,
  })
}

// Makes the next list query read the database at once and return its rows
// only when released, so the reload it belongs to stays open while the test
// changes the library.
function holdNextListQuery() {
  const files = app().files
  // A spy left from an earlier hold would otherwise end up calling itself.
  if (jest.isMockFunction(files.queryLibrary)) jest.mocked(files.queryLibrary).mockRestore()
  const queryLibrary = files.queryLibrary.bind(files)
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  const query = jest.fn(async (params: LibraryQueryParams) => {
    const rows = await queryLibrary(params)
    await released
    return rows
  })
  jest.spyOn(files, 'queryLibrary').mockImplementationOnce(query).mockImplementation(queryLibrary)
  return { query, release }
}

describe('useFileList with the app database', () => {
  beforeEach(async () => {
    await initializeDB()
    for (let i = 0; i < 45; i++) await createFile(`file-${i}`, 1_000 + i)
  })

  afterEach(async () => {
    await resetDb()
    jest.restoreAllMocks()
  })

  test('after the next page fails to load, the spinner clears and scrolling loads it', async () => {
    const { result, unmount } = await renderHook(() => useGrid(), { wrapper })
    await waitFor(() => expect(result.current.files).toHaveLength(40))

    const files = app().files
    const queryLibrary = files.queryLibrary.bind(files)
    jest
      .spyOn(files, 'queryLibrary')
      .mockRejectedValueOnce(new Error('Database is suspended for background transition'))
      .mockImplementation(queryLibrary)

    await act(async () => result.current.loadMore())
    await waitFor(() => expect(result.current.isValidating).toBe(false))
    expect(result.current.isLoadingMore).toBe(false)

    await act(async () => result.current.loadMore())
    await waitFor(() => expect(result.current.files).toHaveLength(45))
    await unmount()
  })

  test('files added while reloads run show once the reloads after them end', async () => {
    const { result, unmount } = await renderHook(() => useGrid(), { wrapper })
    await waitFor(() => expect(result.current.files).toHaveLength(40))

    // A reload that read the library before the first file was added.
    const first = holdNextListQuery()
    await act(async () => app().caches.libraryVersion.invalidate())
    await waitFor(() => expect(first.query).toHaveBeenCalled())
    await createFile('added-during-reload', 5_000)

    // The reload queued for that change, held open while a second file lands.
    const second = holdNextListQuery()
    first.release()
    await waitFor(() => expect(second.query).toHaveBeenCalled())
    await createFile('added-during-trailing-reload', 6_000)
    second.release()

    await waitFor(() =>
      expect(result.current.files?.slice(0, 2).map((f) => f.id)).toEqual([
        'added-during-trailing-reload',
        'added-during-reload',
      ]),
    )
    await unmount()
  })

  test('a reload queued before the sort changes leaves the new sort to its own reloads', async () => {
    const { result, rerender, unmount } = await renderHook(
      (params: FileListParams) => useGrid(params),
      { wrapper, initialProps: { scope: 'sort-test', sortBy: 'DATE' } },
    )
    await waitFor(() => expect(result.current.files).toHaveLength(40))

    const held = holdNextListQuery()
    await act(async () => app().caches.libraryVersion.invalidate())
    await waitFor(() => expect(held.query).toHaveBeenCalled())
    await act(async () => app().caches.libraryVersion.invalidate())

    await rerender({ scope: 'sort-test', sortBy: 'NAME' })
    await waitFor(() => expect(result.current.files?.[0]?.id).toBe('file-0'))
    const queryLibrary = jest.spyOn(app().files, 'queryLibrary')
    queryLibrary.mockClear()
    held.release()

    // The trailing reload belongs to the date sort, which no hook shows now.
    await waitFor(() => expect(result.current.isValidating).toBe(false))
    expect(queryLibrary.mock.calls.filter(([p]) => p.sortBy === 'NAME')).toHaveLength(0)
    await unmount()
  })
})
