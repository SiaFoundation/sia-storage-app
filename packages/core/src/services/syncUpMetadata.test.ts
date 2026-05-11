// Pure-helper coverage. The syncUpMetadataBatch orchestration (push / CAS clear /
// remote-newer / mid-round-trip / tombstone-delete / object-not-found / version-skip)
// is driven against a real DB in apps/mobile/src/managers/syncUpMetadata.test.ts.
import { diffFileMetadata } from './syncUpMetadata'

describe('diffFileMetadata', () => {
  const base = {
    id: 'f1',
    name: 'a.jpg',
    type: 'image/jpeg',
    kind: 'file' as const,
    size: 1,
    hash: 'h',
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
  }

  it('reports no diff for identical metadata', () => {
    expect(Object.keys(diffFileMetadata(base, base))).toHaveLength(0)
  })

  it('detects a scalar field change', () => {
    expect(diffFileMetadata(base, { ...base, name: 'b.jpg' }).name).toBeDefined()
  })

  // tags and directory are pushed to the indexer but are NOT scalar metadata
  // columns, so a tag/directory-only edit must be detected even when updatedAt
  // coincidentally matches remote — otherwise the no-diff branch would clear
  // the flag and the edit would never be pushed.
  it('detects a tag-only change when updatedAt is identical', () => {
    const diffs = diffFileMetadata({ ...base, tags: ['x'] }, base)
    expect(diffs.tags).toBeDefined()
  })

  it('treats tag order as insensitive', () => {
    const diffs = diffFileMetadata({ ...base, tags: ['a', 'b'] }, { ...base, tags: ['b', 'a'] })
    expect(diffs.tags).toBeUndefined()
  })

  it('treats absent and empty tag lists as equal', () => {
    expect(diffFileMetadata({ ...base, tags: [] }, base).tags).toBeUndefined()
  })

  it('detects a directory-only change when updatedAt is identical', () => {
    const diffs = diffFileMetadata({ ...base, directory: '/photos' }, base)
    expect(diffs.directory).toBeDefined()
  })

  it('ignores trashedAt for thumbnails (not encoded in the thumb payload)', () => {
    const local = { ...base, kind: 'thumb' as const, trashedAt: 123 }
    const remote = { ...base, kind: 'thumb' as const, trashedAt: null }
    expect(diffFileMetadata(local, remote)).toEqual({})
  })
})
