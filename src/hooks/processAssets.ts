import * as ImagePicker from 'react-native-image-picker'
import { uniqueId } from './uniqueId'
import { logger } from './logger'
import {
  createManyFileRecords,
  FileRecord,
  readFileRecordsByFingerprints,
  readFileRecordsByLocalIds,
} from '../stores/files'
import { mimeFromAssetUri } from './fileTypes'
import { buildFingerprintV1 } from './fingerprint'

export type PickerAsset = {
  id: string
  localId: string | null
  fileName: string
  fileSize: number
  createdAt: number
  fileType: string
  width?: number
  height?: number
  duration?: number
}

export async function proccessAssets(
  pickerAssets: ImagePicker.Asset[],
  defaultFileName: string = 'file'
) {
  const originalAssets = pickerAssets ?? []
  const originalAssetsCount = originalAssets.length
  const assets = originalAssets
    .filter((a) => a.id && a.uri && a.fileName && a.fileSize)
    .map((a) => ({
      id: uniqueId(),
      localId: a.id ?? null,
      fileName: a.fileName ?? defaultFileName,
      fileSize: a.fileSize ?? 0,
      createdAt: new Date(a.timestamp ?? Date.now()).getTime(),
      width: a.width,
      height: a.height,
      duration: a.duration,
      fileType: a.type ?? mimeFromAssetUri(a),
    }))
    .map((a) => ({
      ...a,
      fingerprint: buildFingerprintV1({
        mime: a.fileType,
        width: a.width,
        height: a.height,
        durationMs: a.duration,
        size: a.fileSize,
        createdAtMs: a.createdAt ? new Date(a.createdAt).getTime() : undefined,
      }),
    }))

  // Check whether assets with the same localId (device id) already exist.
  // This will only detect duplicates within same device.
  const existingFilesByLocalId = await readFileRecordsByLocalIds(
    assets.filter((a) => a.localId !== null).map((a) => a.localId!)
  )

  // Check whether assets with the same fingerprint already exist.
  // This may detect duplicates across devices.
  const existingFilesByFingerprint = await readFileRecordsByFingerprints(
    assets.map((a) => a.fingerprint)
  )

  const existingLocalIdSet = new Set(
    existingFilesByLocalId.map((f) => f.localId)
  )
  const existingFingerprintSet = new Set(
    existingFilesByFingerprint.map((f) => f.fingerprint)
  )

  const newAssets = assets.filter(
    (a) =>
      !(a.localId && existingLocalIdSet.has(a.localId)) &&
      !existingFingerprintSet.has(a.fingerprint)
  )

  const warnings: string[] = []
  const withoutRequiredFieldsCount = originalAssetsCount - newAssets.length
  const existingFilesByLocalIdCount = existingFilesByLocalId.length
  const existingFilesByFingerprintCount = existingFilesByFingerprint.length
  logger.log(
    `[processAssets] original assets: ${originalAssetsCount}, new assets: ${newAssets.length}, without required fields: ${withoutRequiredFieldsCount}, existing files by localId: ${existingFilesByLocalIdCount}, existing files by fingerprint: ${existingFilesByFingerprintCount}`
  )
  if (withoutRequiredFieldsCount > 0) {
    warnings.push(
      'Some files were missing required metadata and were not included.'
    )
  }
  if (existingFilesByLocalIdCount > 0 || existingFilesByFingerprintCount > 0) {
    warnings.push('Some files were duplicates and were not included.')
  }

  if (newAssets.length === 0) {
    logger.log('[processAssets] no media selected.')
    return {
      files: [],
      warnings,
    }
  }

  const files: FileRecord[] = newAssets.map((a) => ({
    id: a.id,
    localId: a.localId,
    fileName: a.fileName,
    fileSize: a.fileSize,
    createdAt: a.createdAt,
    updatedAt: a.createdAt,
    fileType: a.fileType,
    fingerprint: a.fingerprint,
    objects: {},
  }))

  await createManyFileRecords(files)

  return {
    files,
    warnings,
  }
}
