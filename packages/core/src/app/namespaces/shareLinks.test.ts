import type { SdkAdapter, SharingKeyRecord } from '../../adapters/sdk'
import { db, setupTestDb, teardownTestDb } from '../../db/operations/test-setup'
import { buildShareLinks } from './shareLinks'

const INDEXER = 'https://idx.example.com'

beforeEach(setupTestDb)
afterEach(teardownTestDb)

describe('share links after a restart', () => {
  it('a link listed before a restart has its address after it with no network', async () => {
    const record: SharingKeyRecord = {
      key: { publicKey: 'ed25519:link', seed: new Uint8Array(32).fill(7) },
      description: 'Sia Storage',
      createdAt: new Date(1),
      objectCount: 0,
    }
    const online = {
      sharingKeys: async (offset: number) => (offset === 0 ? [record] : []),
      sharedObjects: async () => [],
    } as unknown as SdkAdapter
    const build = (requireSdk: () => SdkAdapter) =>
      buildShareLinks({
        db: db(),
        requireSdk,
        getIndexerURL: async () => INDEXER,
        invalidate: () => {},
      })
    await build(() => online).syncLinks({ refresh: true })

    // A restart builds the namespace again over the same database.
    const restarted = build(() => {
      throw new Error('offline')
    })

    expect((await restarted.links()).map((l) => l.url)).toEqual([
      `https://share.sia.storage/#share=${'07'.repeat(32)}`,
    ])
  })
})
