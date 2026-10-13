import { cache, serialize } from 'swr/_internal'
import type { AppService } from '../app/service'
import { primeListRowCaches } from './library'
import { swrFillableCacheBy } from './swr'

// Cache key parity tests: the keys read here must match the ones the
// consumer hooks read (`useIsFavorite` and `useFsFileUri`). If those hook key
// formats change without updating the primer, each row fetches its own.
//   - `favorite/${id}`, read by `useIsFavorite` in packages/core/src/stores/tags.ts
//   - `${id}` (the raw id), read by `useFsFileUri` in apps/mobile/src/stores/fs.ts

function makeApp() {
  const tags = swrFillableCacheBy()
  const fsFileUri = swrFillableCacheBy<string | null>()
  const uri = jest.fn((file: { id: string; type: string }) => `/predicted/${file.id}.bin`)
  const app = { caches: { tags, fsFileUri }, fs: { uri } } as unknown as AppService
  const read = (c: { key: (...parts: string[]) => string[] }, ...parts: string[]) =>
    cache.get(serialize(c.key(...parts))[0])?.data
  const mark = () => ({ tags: tags.mark(), fsFileUri: fsFileUri.mark() })
  return { app, tags, fsFileUri, uri, read, mark }
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
    mediaAssetId: null,
    trashedAt: null,
    deletedAt: null,
    lostReason: null,
    isFavorite,
    fsExists,
  } as unknown as Parameters<typeof primeListRowCaches>[1][number]
}

describe('primeListRowCaches', () => {
  it('writes the favorite flag under the key `useIsFavorite` reads', () => {
    const { app, tags, read, mark } = makeApp()
    primeListRowCaches(app, [row('f1', 1, 0), row('f2', 0, 0)], mark())
    expect(read(tags, 'favorite/f1')).toBe(true)
    expect(read(tags, 'favorite/f2')).toBe(false)
  })

  it('writes the predicted path under the raw file id when the file is on the device', () => {
    const { app, fsFileUri, uri, read, mark } = makeApp()
    primeListRowCaches(app, [row('f1', 0, 1)], mark())
    expect(uri).toHaveBeenCalledWith({ id: 'f1', type: 'image/jpeg' })
    expect(read(fsFileUri, 'f1')).toBe('/predicted/f1.bin')
  })

  it('a download that lands while the list query runs still shows as on the device', () => {
    const { app, fsFileUri, read, mark } = makeApp()
    const since = mark()
    // The download finishes after the query read the file's row.
    void fsFileUri.set('/downloaded/f1.bin', 'f1')
    primeListRowCaches(app, [row('f1', 0, 0)], since)
    expect(read(fsFileUri, 'f1')).toBe('/downloaded/f1.bin')
  })

  it('a favorite toggled while the list query runs keeps its new value', () => {
    const { app, tags, read, mark } = makeApp()
    const since = mark()
    void tags.set(true, 'favorite/f1')
    primeListRowCaches(app, [row('f1', 0, 0)], since)
    expect(read(tags, 'favorite/f1')).toBe(true)
  })

  it('an older query returning after a newer one leaves the newer answer', () => {
    const { app, fsFileUri, read, mark } = makeApp()
    const older = mark()
    const newer = mark()
    primeListRowCaches(app, [row('f1', 0, 1)], newer)
    primeListRowCaches(app, [row('f1', 0, 0)], older)
    expect(read(fsFileUri, 'f1')).toBe('/predicted/f1.bin')
  })
})
