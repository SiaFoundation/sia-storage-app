import {
  DIRECTORY_ID_PREFIX,
  directoryProviderId,
  parseDirectoryProviderId,
  WORKING_SET_ID,
  type ProviderChanges,
  type ProviderItem,
  type ProviderPage,
} from './provider'
import type { ChangeEvent } from './changes'

const item: ProviderItem = {
  id: 'file-1',
  parentId: 'dir:d1',
  name: 'photo.jpg',
  kind: 'file',
  size: 2048,
  createdAt: 1_700_000_000_000,
  modifiedAt: 1_700_000_100_000,
  contentVersion: 'abc123',
  metadataVersion: '1700000100000',
  uploaded: true,
  uploading: false,
  downloaded: true,
  downloading: false,
  progress: 0,
}

describe('directory identifiers', () => {
  it('round-trips a directory row id', () => {
    expect(parseDirectoryProviderId(directoryProviderId('d1'))).toBe('d1')
  })

  it('reads a bare id as a file', () => {
    expect(parseDirectoryProviderId('file-1')).toBeNull()
  })

  it('keeps a directory id whose row id contains the prefix', () => {
    const nested = directoryProviderId(`${DIRECTORY_ID_PREFIX}odd`)
    expect(parseDirectoryProviderId(nested)).toBe(`${DIRECTORY_ID_PREFIX}odd`)
  })

  it('carries no path, so an identifier survives a rename', () => {
    expect(directoryProviderId('d1')).not.toContain('/')
  })

  it('cannot collide with the working set', () => {
    expect(parseDirectoryProviderId(WORKING_SET_ID)).toBeNull()
    expect(directoryProviderId('d1')).not.toBe(WORKING_SET_ID)
  })
})

describe('wire shapes survive a JSON round trip', () => {
  function roundTrip<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  it('preserves every ProviderItem field', () => {
    expect(roundTrip(item)).toEqual(item)
  })

  it('preserves a null parentId for a root entry', () => {
    const root: ProviderItem = { ...item, parentId: null }
    expect(roundTrip(root).parentId).toBeNull()
  })

  it('preserves a page with and without a cursor', () => {
    const more: ProviderPage = { items: [item], cursor: 'c1' }
    const last: ProviderPage = { items: [] }
    expect(roundTrip(more)).toEqual(more)
    expect(roundTrip(last)).toEqual(last)
  })

  it('preserves a change set including its deletions', () => {
    const changes: ProviderChanges = {
      items: [item],
      deletedIds: ['file-2', 'dir:d9'],
      anchor: '42',
      hasMore: false,
      expired: false,
    }
    expect(roundTrip(changes)).toEqual(changes)
  })

  it('carries nothing but a scope on a change event', () => {
    const event: ChangeEvent = { event: 'change', scope: 'library' }
    expect(Object.keys(roundTrip(event)).sort()).toEqual(['event', 'scope'])
  })
})
