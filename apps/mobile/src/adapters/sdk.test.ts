import path from 'node:path'
import type { PinnedObjectRef } from '@siastorage/core/adapters'
import {
  type PackedUploadOptions,
  type SdkInterface,
  SharingKey,
  type SharingKeyInterface,
} from 'react-native-sia'
import { MobileSdkAdapter } from './sdk'

describe('sharing keys', () => {
  it('lists a key as plain data: its seed, when it expires and how many objects it holds', async () => {
    const seed = new Uint8Array(32).fill(3)
    const key = SharingKey.fromSeed(seed.buffer)
    const createdAt = new Date(1_000)
    const expiresAt = new Date(2_000)
    const sharingKeys = jest.fn(async () => [
      {
        key,
        description: 'Sia Storage snapshot',
        stats: {
          objectCount: 3n,
          objectSize: 0n,
          pinnedData: 0n,
          pinnedSize: 0n,
          expiresAt,
          createdAt,
          updatedAt: createdAt,
        },
      },
    ])
    const adapter = new MobileSdkAdapter({ sharingKeys } as unknown as SdkInterface)

    const records = await adapter.sharingKeys(0, 100)

    expect(sharingKeys).toHaveBeenCalledWith(0, 100)
    expect(records).toEqual([
      {
        key: { publicKey: key.publicKey(), seed },
        description: 'Sia Storage snapshot',
        expiresAt,
        createdAt,
        objectCount: 3,
      },
    ])
  })

  it('hands the SDK a key rebuilt from exactly the seed, when the seed is a view into a larger buffer', async () => {
    const backing = new Uint8Array(40).fill(9)
    backing.set(new Uint8Array(32).fill(5), 4)
    const shareObject = jest.fn(async (_key: SharingKeyInterface, _object: unknown) => {})
    const adapter = new MobileSdkAdapter({ shareObject } as unknown as SdkInterface)
    const object = {} as PinnedObjectRef

    await adapter.shareObject({ publicKey: 'ed25519:view', seed: backing.subarray(4, 36) }, object)

    const [key, passed] = shareObject.mock.calls[0]
    expect(new Uint8Array(key.seed())).toEqual(new Uint8Array(32).fill(5))
    expect(passed).toBe(object)
  })
})

describe('upload options', () => {
  // The real generated bindings, not the jest mock of react-native-sia. Encoding
  // a record needs no native module, so this runs the converter uploadPacked
  // calls on its options. The package's exports map hides the file, so it is
  // loaded by path.
  const bindings: {
    converters: {
      FfiConverterTypePackedUploadOptions: {
        lower(value: PackedUploadOptions, alloc: (n: number) => Uint8Array): Uint8Array
      }
    }
  } = jest.requireActual(
    path.join(
      path.dirname(require.resolve('react-native-sia/package.json')),
      'lib/module/generated/sia_storage_ffi.js',
    ),
  ).default

  it('encodes packed upload options that carry a shard progress callback', () => {
    const lower = () =>
      bindings.converters.FfiConverterTypePackedUploadOptions.lower(
        {
          dataShards: 10,
          parityShards: 20,
          maxBufferedSlabs: 4,
          shardUploaded: { progress: () => {} },
        },
        (n: number) => new Uint8Array(n),
      )

    expect(lower).not.toThrow()
  })
})
