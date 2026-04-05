/**
 * Mock for expo-media-library with test helpers.
 */

export type MediaType = 'audio' | 'photo' | 'video' | 'unknown'
export type SortBy =
  | 'default'
  | 'mediaType'
  | 'width'
  | 'height'
  | 'creationTime'
  | 'modificationTime'
  | 'duration'

export type Asset = {
  id: string
  filename: string
  uri: string
  mediaType: MediaType
  width: number
  height: number
  creationTime: number
  modificationTime: number
  duration: number
  albumId?: string
}

export type PagedInfo<T> = {
  assets: T[]
  endCursor: string
  hasNextPage: boolean
  totalCount: number
}

export type GetAssetsOptions = {
  first?: number
  after?: string
  album?: string
  sortBy?: SortBy | SortBy[]
  mediaType?: MediaType | MediaType[]
  createdAfter?: number
  createdBefore?: number
}

export type PermissionStatus = 'granted' | 'denied' | 'undetermined'

export type PermissionResponse = {
  status: PermissionStatus
  granted: boolean
  canAskAgain: boolean
  expires: 'never' | number
  accessPrivileges?: 'all' | 'limited' | 'none'
}

interface MockMediaLibraryState {
  assets: Asset[]
  permissionStatus: PermissionStatus
}

const state: MockMediaLibraryState = {
  assets: [],
  permissionStatus: 'granted',
}

export function setAssets(assets: Asset[]): void {
  state.assets = [...assets]
}

export function addAssets(assets: Asset[]): void {
  state.assets.push(...assets)
}

export function clearAssets(): void {
  state.assets = []
}

export function setPermissionStatus(status: PermissionStatus): void {
  state.permissionStatus = status
}

export function getAssetCount(): number {
  return state.assets.length
}

export async function getAssetsAsync(options: GetAssetsOptions = {}): Promise<PagedInfo<Asset>> {
  const { first = 20, after, createdAfter, mediaType } = options

  let filtered = [...state.assets]

  if (createdAfter) {
    filtered = filtered.filter((a) => a.creationTime > createdAfter)
  }

  if (mediaType) {
    const types = Array.isArray(mediaType) ? mediaType : [mediaType]
    filtered = filtered.filter((a) => types.includes(a.mediaType))
  }

  filtered.sort((a, b) => b.creationTime - a.creationTime)

  let startIndex = 0
  if (after) {
    const afterIndex = filtered.findIndex((a) => a.id === after)
    if (afterIndex >= 0) {
      startIndex = afterIndex + 1
    }
  }

  const sliced = filtered.slice(startIndex, startIndex + first)
  const lastAsset = sliced[sliced.length - 1]

  return {
    assets: sliced,
    endCursor: lastAsset?.id ?? '',
    hasNextPage: startIndex + first < filtered.length,
    totalCount: filtered.length,
  }
}

export async function getAssetInfoAsync(asset: Asset | string): Promise<Asset | undefined> {
  const id = typeof asset === 'string' ? asset : asset.id
  return state.assets.find((a) => a.id === id)
}

export async function requestPermissionsAsync(): Promise<PermissionResponse> {
  return {
    status: state.permissionStatus,
    granted: state.permissionStatus === 'granted',
    canAskAgain: state.permissionStatus !== 'denied',
    expires: 'never',
    accessPrivileges: state.permissionStatus === 'granted' ? 'all' : 'none',
  }
}

export async function getPermissionsAsync(): Promise<PermissionResponse> {
  return requestPermissionsAsync()
}

export const MediaType = {
  audio: 'audio' as MediaType,
  photo: 'photo' as MediaType,
  video: 'video' as MediaType,
  unknown: 'unknown' as MediaType,
}

export const SortBy = {
  default: 'default' as SortBy,
  mediaType: 'mediaType' as SortBy,
  width: 'width' as SortBy,
  height: 'height' as SortBy,
  creationTime: 'creationTime' as SortBy,
  modificationTime: 'modificationTime' as SortBy,
  duration: 'duration' as SortBy,
}

export function generateMockPhoto(id: number): Asset {
  const now = Date.now()
  return {
    id: `photo-${id}`,
    filename: `IMG_${String(id).padStart(4, '0')}.jpg`,
    uri: `file://photos/IMG_${String(id).padStart(4, '0')}.jpg`,
    mediaType: 'photo',
    width: 1920,
    height: 1080,
    creationTime: now - id * 1000,
    modificationTime: now - id * 1000,
    duration: 0,
  }
}

export function generateMockVideo(id: number): Asset {
  const now = Date.now()
  return {
    id: `video-${id}`,
    filename: `VID_${String(id).padStart(4, '0')}.mp4`,
    uri: `file://videos/VID_${String(id).padStart(4, '0')}.mp4`,
    mediaType: 'video',
    width: 1920,
    height: 1080,
    creationTime: now - id * 1000,
    modificationTime: now - id * 1000,
    duration: 30,
  }
}

export function generateMockPhotos(count: number, options: { startId?: number } = {}): Asset[] {
  const { startId = 1 } = options
  return Array.from({ length: count }, (_, i) => generateMockPhoto(startId + i))
}

export function generateMockAssets(
  count: number,
  options: { startId?: number; type?: 'photo' | 'video' | 'mixed' } = {},
): Asset[] {
  const { startId = 1, type = 'mixed' } = options
  return Array.from({ length: count }, (_, i) => {
    const id = startId + i
    if (type === 'photo') return generateMockPhoto(id)
    if (type === 'video') return generateMockVideo(id)
    return i % 3 === 0 ? generateMockVideo(id) : generateMockPhoto(id)
  })
}

export function resetMock(): void {
  state.assets = []
  state.permissionStatus = 'granted'
}
