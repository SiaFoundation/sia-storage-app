import type { AppService } from '../app/service'
import { primeListRowCaches } from './library'

// Cache key parity tests — the literals used here must match the
// keys read by the consumer hooks (`useIsFavorite` and `useFsFileUri`).
// If those hook key formats change without updating the primer, the
// optimization silently degrades to per-row fetcher fan-out.
//   - `favorite/${id}` → `packages/core/src/stores/tags.ts` `useIsFavorite`
//   - `${id}` (raw id) → `apps/mobile/src/stores/fs.ts`     `useFsFileUri`

type CacheSpy = {
  set: jest.Mock
}

function makeApp(): { app: AppService; tags: CacheSpy; fsFileUri: CacheSpy; uri: jest.Mock } {
  const tags: CacheSpy = { set: jest.fn() }
  const fsFileUri: CacheSpy = { set: jest.fn() }
  const uri = jest.fn((file: { id: string; type: string }) => `/predicted/${file.id}.bin`)
  const app = {
    caches: { tags, fsFileUri },
    fs: { uri },
  } as unknown as AppService
  return { app, tags, fsFileUri, uri }
}

function row(id: string, isFavorite: 0 | 1, fsExists: 0 | 1) {
  return {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    kind: 'file',
    size: 100,
    hash: 'sha256:x',
    createdAt: 1,
    updatedAt: 1,
    addedAt: 1,
    localId: null,
    trashedAt: null,
    deletedAt: null,
    lostReason: null,
    isFavorite,
    fsExists,
  } as unknown as Parameters<typeof primeListRowCaches>[1][number]
}

describe('primeListRowCaches', () => {
  it('writes the favorite cache with the same key shape `useIsFavorite` reads', () => {
    const { app, tags } = makeApp()
    primeListRowCaches(app, [row('f1', 1, 0)])
    expect(tags.set).toHaveBeenCalledWith(true, 'favorite/f1')
  })

  it('writes false to the favorite cache when the join column is 0', () => {
    const { app, tags } = makeApp()
    primeListRowCaches(app, [row('f1', 0, 0)])
    expect(tags.set).toHaveBeenCalledWith(false, 'favorite/f1')
  })

  it('writes the predicted URI to fsFileUri keyed by raw file id when fsExists=1', () => {
    const { app, fsFileUri, uri } = makeApp()
    primeListRowCaches(app, [row('f1', 0, 1)])
    expect(uri).toHaveBeenCalledWith({ id: 'f1', type: 'image/jpeg' })
    expect(fsFileUri.set).toHaveBeenCalledWith('/predicted/f1.bin', 'f1')
  })

  it('writes null to fsFileUri when fsExists=0 (no stat call)', () => {
    const { app, fsFileUri, uri } = makeApp()
    primeListRowCaches(app, [row('f1', 0, 0)])
    expect(fsFileUri.set).toHaveBeenCalledWith(null, 'f1')
    expect(uri).not.toHaveBeenCalled()
  })
})
