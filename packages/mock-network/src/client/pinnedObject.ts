/**
 * Object handles for the mock network. A mock object has no keys or slabs, so
 * a handle is its id, size, timestamps and plaintext metadata.
 *
 * Sealing stores the plaintext metadata where the real SDK puts ciphertext,
 * and records the size as the length of one placeholder slab. That is how
 * openLocalPinnedObject gets a handle back from a stored LocalObject with no
 * request, which it has to because the SDK method is synchronous.
 */
import type { AppKeyRef, PinnedObjectRef, SealedObjectRef } from '@siastorage/core/adapters'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import type { Slab } from '@siastorage/core/types'
import { fromHex, type WireObject } from '../protocol'

type ObjectState = {
  id: string
  metadata: ArrayBuffer
  size: bigint
  createdAt: Date
  updatedAt: Date
}

function placeholderSlab(size: bigint): Slab {
  return {
    version: 1,
    encryptionKey: new ArrayBuffer(32),
    minShards: 10,
    sectors: [],
    offset: 0,
    length: Number(size),
  }
}

function handle(state: ObjectState): PinnedObjectRef {
  return {
    id: () => state.id,
    metadata: () => state.metadata,
    // Local only, as in the real SDK. The network sees it on the next
    // pinObject or updateObjectMetadata.
    updateMetadata: (metadata) => {
      state.metadata = metadata
    },
    size: () => state.size,
    encodedSize: () => state.size,
    slabs: () => [],
    createdAt: () => state.createdAt,
    updatedAt: () => state.updatedAt,
    seal: (_appKey: AppKeyRef): SealedObjectRef => ({
      id: state.id,
      slabs: [placeholderSlab(state.size)],
      encryptedDataKey: new ArrayBuffer(32),
      encryptedMetadataKey: new ArrayBuffer(32),
      encryptedMetadata: state.metadata.slice(0),
      dataSignature: new ArrayBuffer(64),
      metadataSignature: new ArrayBuffer(64),
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    }),
  }
}

export function pinnedObjectFromWire(w: WireObject): PinnedObjectRef {
  return handle({
    id: w.id,
    metadata: fromHex(w.metadata).buffer,
    size: BigInt(w.size),
    createdAt: new Date(w.createdAt),
    updatedAt: new Date(w.updatedAt),
  })
}

export function openLocalPinnedObject(object: LocalObject): PinnedObjectRef {
  const size = object.slabs.reduce((sum, slab) => sum + BigInt(slab.length), 0n)
  return handle({
    id: object.id,
    metadata: object.encryptedMetadata.slice(0),
    size,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
  })
}
