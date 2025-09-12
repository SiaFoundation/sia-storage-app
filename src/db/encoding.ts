import { PinnedObject } from 'react-native-sia'
import { hexToUint8, arrayBufferToHex } from '../lib/hex'
import { z } from 'zod'

type SerializedPinnedObject = {
  key: string
  slabs: { id: string; offset: number; length: number }[]
  metadata: string
  createdAt: string
  updatedAt: string
}

const hexArrayBuffer = z.codec(z.hex(), z.instanceof(ArrayBuffer), {
  decode: (hex) => hexToUint8(hex).slice().buffer as ArrayBuffer,
  encode: (buf) => arrayBufferToHex(buf),
})

const epochOrIsoToDate = z.codec(z.union([z.number(), z.string()]), z.date(), {
  decode: (value) => new Date(value as any),
  encode: (date) => date.toISOString(),
})

const slabSchema = z.object({
  id: z.string(),
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
})

const pinnedObjectSchema = z.object({
  key: z.string(),
  slabs: z.array(slabSchema),
  metadata: z.instanceof(ArrayBuffer),
  createdAt: z.date(),
  updatedAt: z.date(),
})

const pinnedObjectStorageInputSchema = z.object({
  key: z.string(),
  slabs: z.array(slabSchema),
  metadata: z.hex(),
  createdAt: z.union([z.string(), z.number()]),
  updatedAt: z.union([z.string(), z.number()]),
})

const pinnedObjectStorageCodec = z.codec(
  pinnedObjectStorageInputSchema,
  pinnedObjectSchema,
  {
    decode: (stored) => ({
      key: stored.key,
      slabs: stored.slabs,
      metadata: hexArrayBuffer.decode(stored.metadata),
      createdAt: epochOrIsoToDate.decode(stored.createdAt),
      updatedAt: epochOrIsoToDate.decode(stored.updatedAt),
    }),
    encode: (po) => ({
      key: po.key,
      slabs: po.slabs,
      metadata: hexArrayBuffer.encode(po.metadata),
      createdAt: epochOrIsoToDate.encode(po.createdAt),
      updatedAt: epochOrIsoToDate.encode(po.updatedAt),
    }),
  }
)

export function serializePinnedObjects(
  pinnedObjects: Record<string, PinnedObject>
): string {
  const encoded: Record<string, SerializedPinnedObject> = Object.fromEntries(
    Object.entries(pinnedObjects).map(([k, v]) => {
      const e = pinnedObjectStorageCodec.encode(v)
      return [
        k,
        {
          key: e.key,
          slabs: e.slabs,
          metadata: e.metadata,
          createdAt: String(e.createdAt),
          updatedAt: String(e.updatedAt),
        } satisfies SerializedPinnedObject,
      ]
    })
  )
  return JSON.stringify(encoded)
}

export function deserializePinnedObjects(
  pinnedObjects: string | null
): Record<string, PinnedObject> {
  if (pinnedObjects == null) return {}
  const parsed = JSON.parse(pinnedObjects) as Record<string, unknown>
  const decoded: Record<string, PinnedObject> = Object.fromEntries(
    Object.entries(parsed).map(([k, v]) => [
      k,
      pinnedObjectStorageCodec.decode(v as any),
    ])
  )
  return decoded
}
