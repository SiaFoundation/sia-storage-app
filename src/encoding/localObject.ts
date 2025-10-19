import { z } from 'zod'
import { hexArrayBufferCodec } from './arrayBuffer'
import { isoToEpochCodec } from './date'
import { slabSchema, slabsStorageCodec } from './slabs'

const localObjectStorageCodec = z.codec(
  z.object({
    id: z.string(),
    fileId: z.string(),
    indexerURL: z.string(),
    slabs: z.string(),
    encryptedMasterKey: z.hex(),
    encryptedMetadata: z.hex(),
    signature: z.hex(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
  z.object({
    id: z.string(),
    fileId: z.string(),
    indexerURL: z.string(),
    slabs: z.array(slabSchema),
    encryptedMasterKey: z.instanceof(ArrayBuffer),
    encryptedMetadata: z.instanceof(ArrayBuffer),
    signature: z.instanceof(ArrayBuffer),
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
  {
    decode: (stored) => ({
      id: stored.id,
      fileId: stored.fileId,
      indexerURL: stored.indexerURL,
      slabs: slabsStorageCodec.decode(stored.slabs),
      encryptedMasterKey: hexArrayBufferCodec.decode(stored.encryptedMasterKey),
      encryptedMetadata: hexArrayBufferCodec.decode(stored.encryptedMetadata),
      signature: hexArrayBufferCodec.decode(stored.signature),
      createdAt: isoToEpochCodec.decode(stored.createdAt),
      updatedAt: isoToEpochCodec.decode(stored.updatedAt),
    }),
    encode: (po) => ({
      id: po.id,
      fileId: po.fileId,
      indexerURL: po.indexerURL,
      slabs: slabsStorageCodec.encode(po.slabs),
      encryptedMasterKey: hexArrayBufferCodec.encode(po.encryptedMasterKey),
      encryptedMetadata: hexArrayBufferCodec.encode(po.encryptedMetadata),
      signature: hexArrayBufferCodec.encode(po.signature),
      createdAt: isoToEpochCodec.encode(po.createdAt),
      updatedAt: isoToEpochCodec.encode(po.updatedAt),
    }),
  }
)

export type LocalObject = ReturnType<typeof localObjectStorageCodec.decode>
export type LocalObjectsMap = Record<string, LocalObject>

export type LocalObjectRow = {
  id: string
  fileId: string
  indexerURL: string
  slabs: string
  encryptedMasterKey: string
  encryptedMetadata: string
  signature: string
  createdAt: number
  updatedAt: number
}

export function localObjectToStorageRow(lo: LocalObject): LocalObjectRow {
  const e = localObjectStorageCodec.encode({
    id: lo.id,
    fileId: lo.fileId,
    indexerURL: lo.indexerURL,
    slabs: lo.slabs,
    encryptedMasterKey: lo.encryptedMasterKey,
    encryptedMetadata: lo.encryptedMetadata,
    signature: lo.signature,
    createdAt: lo.createdAt,
    updatedAt: lo.updatedAt,
  })
  return {
    id: e.id,
    fileId: e.fileId,
    indexerURL: e.indexerURL,
    slabs: e.slabs,
    encryptedMasterKey: e.encryptedMasterKey,
    encryptedMetadata: e.encryptedMetadata,
    signature: e.signature,
    createdAt: Number(e.createdAt),
    updatedAt: Number(e.updatedAt),
  }
}

export function localObjectFromStorageRow(row: LocalObjectRow): LocalObject {
  return localObjectStorageCodec.decode({
    id: row.id,
    fileId: row.fileId,
    indexerURL: row.indexerURL,
    slabs: row.slabs,
    encryptedMasterKey: row.encryptedMasterKey,
    encryptedMetadata: row.encryptedMetadata,
    signature: row.signature,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}
