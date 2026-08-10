import { z } from 'zod'
import type { PinnedSector, Slab } from '../types/slabs'
import { hexArrayBufferCodec } from './arrayBuffer'

export const pinnedSectorSchema = z.object({
  root: z.string(),
  hostKey: z.string(),
}) satisfies z.ZodType<PinnedSector>

export const slabSchema = z.object({
  version: z.number().int().nonnegative(),
  encryptionKey: z.instanceof(ArrayBuffer),
  minShards: z.number().int().nonnegative(),
  sectors: z.array(pinnedSectorSchema),
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
}) satisfies z.ZodType<Slab>

type SlabStorage = {
  version?: number
  encryptionKey: string
  minShards: number
  sectors: PinnedSector[]
  offset: number
  length: number
}

const slabStorageSchema = z.object({
  // Rows written before slab versions have no version key, equivalent to zero.
  version: z.number().int().nonnegative().optional(),
  encryptionKey: z.hex(),
  minShards: z.number().int().nonnegative(),
  sectors: z.array(pinnedSectorSchema),
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
}) satisfies z.ZodType<SlabStorage>

// Codec for a single Slab.
export const slabCodec = z.codec(slabStorageSchema, slabSchema, {
  decode: (stored: SlabStorage): Slab => ({
    ...stored,
    version: stored.version ?? 0,
    encryptionKey: hexArrayBufferCodec.decode(stored.encryptionKey),
  }),
  encode: (domain: Slab): SlabStorage => ({
    ...domain,
    encryptionKey: hexArrayBufferCodec.encode(domain.encryptionKey),
  }),
})

// Codec for an array of Slabs.
export const slabsStorageCodec = z.codec(z.string(), z.array(slabSchema), {
  decode: (stored: string): Slab[] => {
    try {
      const parsed = JSON.parse(stored)
      const result = slabStorageSchema.array().safeParse(parsed)
      if (!result.success) return []
      const storageSlabs: SlabStorage[] = result.data
      return storageSlabs.map((slab) => slabCodec.decode(slab))
    } catch {
      return []
    }
  },
  encode: (domain: Slab[]): string => {
    const storageSlabs: SlabStorage[] = (domain ?? []).map((slab) => slabCodec.encode(slab))
    return JSON.stringify(storageSlabs)
  },
})
