import { renderHook } from '@testing-library/react-native'
import type { useUploadProgress } from '../stores/uploads'
import { useAppStatus } from './useAppStatus'

type Progress = ReturnType<typeof useUploadProgress>

const idle: Progress = {
  show: false,
  packerCount: 0,
  packerFileCount: 0,
  packerFileBytes: 0,
  pendingCount: 0,
  importingFileCount: 0,
  waitingFileCount: 0,
  percentDecimal: 0,
}
let mockProgress: Progress = idle

jest.mock('lucide-react-native', () => ({
  CircleCheckIcon: () => null,
  CloudDownloadIcon: () => null,
  CloudUploadIcon: () => null,
  TriangleAlertIcon: () => null,
}))

jest.mock('@siastorage/core/stores', () => ({
  useHasOnboarded: () => true,
  useIsInitializing: () => false,
  useSyncState: () => ({ data: { isSyncingDown: false, isSyncingUp: false } }),
}))

jest.mock('../stores/sdk', () => ({
  reconnectIndexer: jest.fn(),
  useIsConnected: () => true,
}))

jest.mock('./useIsOnline', () => ({
  useIsOnline: () => ({ data: true }),
}))

jest.mock('../stores/uploads', () => ({
  useUploadProgress: () => mockProgress,
}))

async function message(over: Partial<Progress>): Promise<string> {
  mockProgress = { ...idle, show: true, ...over }
  const { result } = await renderHook(() => useAppStatus())
  return result.current.message
}

describe('useAppStatus', () => {
  it('says files are importing while an import still copies them in', async () => {
    expect(await message({ pendingCount: 5, importingFileCount: 3, waitingFileCount: 2 })).toBe(
      'Importing 3 files',
    )
  })

  it('says files already in the library are waiting to upload', async () => {
    expect(await message({ pendingCount: 2, waitingFileCount: 2 })).toBe(
      'Waiting to upload 2 files',
    )
    expect(await message({ pendingCount: 1, waitingFileCount: 1 })).toBe('Waiting to upload 1 file')
  })

  it('drops the count when only thumbnails wait', async () => {
    expect(await message({ pendingCount: 1 })).toBe('Waiting to upload')
  })
})
