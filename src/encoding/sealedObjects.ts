import { SealedObject } from 'react-native-sia'
import { hexToUint8, arrayBufferToHex } from '../lib/hex'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { MaybeError } from '../lib/types'
import { epochOrIsoToDate } from '.'

const hexArrayBuffer = z.codec(z.hex(), z.instanceof(ArrayBuffer), {
  decode: (hex) => hexToUint8(hex).slice().buffer as ArrayBuffer,
  encode: (buf) => arrayBufferToHex(buf),
})

const slabSchema = z.object({
  id: z.string(),
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
})

const sealedObjectSchema = z.object({
  id: z.string(),
  slabs: z.array(slabSchema),
  encryptedMasterKey: z.instanceof(ArrayBuffer),
  encryptedMetadata: z.instanceof(ArrayBuffer),
  signature: z.instanceof(ArrayBuffer),
  createdAt: z.date(),
  updatedAt: z.date(),
})

const sealedObjectStorageInputSchema = z.object({
  id: z.string(),
  slabs: z.array(slabSchema),
  encryptedMasterKey: z.hex(),
  encryptedMetadata: z.hex(),
  signature: z.hex(),
  createdAt: z.union([z.string(), z.number()]),
  updatedAt: z.union([z.string(), z.number()]),
})

const sealedObjectStorageCodec = z.codec(
  sealedObjectStorageInputSchema,
  sealedObjectSchema,
  {
    decode: (stored) => ({
      id: stored.id,
      slabs: stored.slabs,
      encryptedMasterKey: hexArrayBuffer.decode(stored.encryptedMasterKey),
      encryptedMetadata: hexArrayBuffer.decode(stored.encryptedMetadata),
      signature: hexArrayBuffer.decode(stored.signature),
      createdAt: epochOrIsoToDate.decode(stored.createdAt),
      updatedAt: epochOrIsoToDate.decode(stored.updatedAt),
    }),
    encode: (po) => ({
      id: po.id,
      slabs: po.slabs,
      encryptedMasterKey: hexArrayBuffer.encode(po.encryptedMasterKey),
      encryptedMetadata: hexArrayBuffer.encode(po.encryptedMetadata),
      signature: hexArrayBuffer.encode(po.signature),
      createdAt: epochOrIsoToDate.encode(po.createdAt),
      updatedAt: epochOrIsoToDate.encode(po.updatedAt),
    }),
  }
)

export type SerializedSealedObject = ReturnType<
  typeof sealedObjectStorageCodec.encode
>
export type SerializedSealedObjectsMap = Record<string, SerializedSealedObject>
export type SealedObjectsMap = Record<string, SealedObject>

export function serializeSealedObjects(
  sealedObjects?: SealedObjectsMap | null
): MaybeError<string> {
  try {
    const encoded: SerializedSealedObjectsMap = Object.fromEntries(
      Object.entries(sealedObjects || {}).map(([k, v]) => {
        const e = sealedObjectStorageCodec.encode(v)
        return [
          k,
          {
            id: e.id,
            slabs: e.slabs,
            encryptedMasterKey: e.encryptedMasterKey,
            encryptedMetadata: e.encryptedMetadata,
            signature: e.signature,
            createdAt: String(e.createdAt),
            updatedAt: String(e.updatedAt),
          } satisfies SerializedSealedObject,
        ]
      })
    )
    return [JSON.stringify(encoded), null]
  } catch (e) {
    logger.log('Error serializing sealed objects', e)
    return [null, e as Error]
  }
}

export function deserializeSealedObjects(
  id: string,
  sealedObjects: string | null
): MaybeError<SealedObjectsMap> {
  try {
    if (sealedObjects == null) return [{}, null]
    const parsed = (JSON.parse(sealedObjects) ||
      {}) as SerializedSealedObjectsMap
    const decoded: SealedObjectsMap = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [
        k,
        sealedObjectStorageCodec.decode(v),
      ])
    )
    return [decoded, null]
  } catch (e) {
    logger.log('Error deserializing sealed objects for file', id, e)
    return [null, e as Error]
  }
}
