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
    encryptedDataKey: z.hex(),
    encryptedMetadataKey: z.hex(),
    encryptedMetadata: z.hex(),
    dataSignature: z.hex(),
    metadataSignature: z.hex(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
  z.object({
    id: z.string(),
    fileId: z.string(),
    indexerURL: z.string(),
    slabs: z.array(slabSchema),
    encryptedDataKey: z.instanceof(ArrayBuffer),
    encryptedMetadataKey: z.instanceof(ArrayBuffer),
    encryptedMetadata: z.instanceof(ArrayBuffer),
    dataSignature: z.instanceof(ArrayBuffer),
    metadataSignature: z.instanceof(ArrayBuffer),
    createdAt: z.date(),
    updatedAt: z.date(),
  }),
  {
    decode: (stored) => ({
      id: stored.id,
      fileId: stored.fileId,
      indexerURL: stored.indexerURL,
      slabs: slabsStorageCodec.decode(stored.slabs),
      encryptedDataKey: hexArrayBufferCodec.decode(stored.encryptedDataKey),
      encryptedMetadataKey: hexArrayBufferCodec.decode(
        stored.encryptedMetadataKey
      ),
      encryptedMetadata: hexArrayBufferCodec.decode(stored.encryptedMetadata),
      dataSignature: hexArrayBufferCodec.decode(stored.dataSignature),
      metadataSignature: hexArrayBufferCodec.decode(stored.metadataSignature),
      createdAt: isoToEpochCodec.decode(stored.createdAt),
      updatedAt: isoToEpochCodec.decode(stored.updatedAt),
    }),
    encode: (po) => ({
      id: po.id,
      fileId: po.fileId,
      indexerURL: po.indexerURL,
      slabs: slabsStorageCodec.encode(po.slabs),
      encryptedDataKey: hexArrayBufferCodec.encode(po.encryptedDataKey),
      encryptedMetadataKey: hexArrayBufferCodec.encode(po.encryptedMetadataKey),
      encryptedMetadata: hexArrayBufferCodec.encode(po.encryptedMetadata),
      dataSignature: hexArrayBufferCodec.encode(po.dataSignature),
      metadataSignature: hexArrayBufferCodec.encode(po.metadataSignature),
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
  encryptedDataKey: string
  encryptedMetadataKey: string
  encryptedMetadata: string
  dataSignature: string
  metadataSignature: string
  createdAt: number
  updatedAt: number
}

export function localObjectToStorageRow(lo: LocalObject): LocalObjectRow {
  const e = localObjectStorageCodec.encode({
    id: lo.id,
    fileId: lo.fileId,
    indexerURL: lo.indexerURL,
    slabs: lo.slabs,
    encryptedDataKey: lo.encryptedDataKey,
    encryptedMetadataKey: lo.encryptedMetadataKey,
    encryptedMetadata: lo.encryptedMetadata,
    dataSignature: lo.dataSignature,
    metadataSignature: lo.metadataSignature,
    createdAt: lo.createdAt,
    updatedAt: lo.updatedAt,
  })
  return {
    id: e.id,
    fileId: e.fileId,
    indexerURL: e.indexerURL,
    slabs: e.slabs,
    encryptedDataKey: e.encryptedDataKey,
    encryptedMetadataKey: e.encryptedMetadataKey,
    encryptedMetadata: e.encryptedMetadata,
    dataSignature: e.dataSignature,
    metadataSignature: e.metadataSignature,
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
    encryptedDataKey: row.encryptedDataKey,
    encryptedMetadataKey: row.encryptedMetadataKey,
    encryptedMetadata: row.encryptedMetadata,
    dataSignature: row.dataSignature,
    metadataSignature: row.metadataSignature,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
}
