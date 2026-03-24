import type { DatabaseAdapter } from '@siastorage/core/adapters'
import * as sql from '@siastorage/core/db/sql'
import type { DatasetConfig, DatasetInfo } from './types'

const TYPES = [
  'image/jpeg',
  'image/jpeg',
  'image/jpeg',
  'image/jpeg',
  'video/mp4',
  'video/mp4',
  'audio/mp3',
  'audio/mp3',
  'application/pdf',
  'text/plain',
]

const BATCH_SIZE = 10_000
const INDEXER_URL = 'https://bench.indexer'

type VersionGroup = { groups: number; versions: number }

function getVersionDistribution(scale: number): VersionGroup[] {
  return [
    { groups: 549_000 * scale, versions: 1 },
    { groups: 100_000 * scale, versions: 2 },
    { groups: 30_000 * scale, versions: 3 },
    { groups: 1_000 * scale, versions: 10 },
    { groups: 1_000 * scale, versions: 50 },
    { groups: 1_000 * scale, versions: 100 },
  ]
}

function getTotalRecords(dist: VersionGroup[]): number {
  return dist.reduce((sum, d) => sum + d.groups * d.versions, 0)
}

function getCurrentCount(dist: VersionGroup[]): number {
  return dist.reduce((sum, d) => sum + d.groups, 0)
}

export async function generateDataset(
  db: DatabaseAdapter,
  config: DatasetConfig,
): Promise<DatasetInfo> {
  const start = performance.now()
  const dist = getVersionDistribution(config.scale)
  const totalRecords = getTotalRecords(dist)
  const dirCount = 50 * config.scale
  const tagCount = 5

  console.log(
    `Generating dataset: ${totalRecords.toLocaleString()} records, ${getCurrentCount(dist).toLocaleString()} current files`,
  )

  // Create directories
  console.log(`  Creating ${dirCount} directories...`)
  const dirIds: string[] = []
  for (let i = 0; i < dirCount; i++) {
    const id = `dir-${String(i).padStart(4, '0')}`
    const name = `folder-${String(i).padStart(4, '0')}`
    dirIds.push(id)
    await db.runAsync(
      'INSERT INTO directories (id, name, createdAt) VALUES (?, ?, ?)',
      id,
      name,
      Date.now(),
    )
  }

  // Create tags
  console.log(`  Creating ${tagCount} tags...`)
  const tagIds: string[] = []
  const tagNames = ['travel', 'family', 'work', 'archive', 'screenshots']
  const now = Date.now()
  for (const name of tagNames) {
    const id = `tag-${name}`
    tagIds.push(id)
    await db.runAsync(
      'INSERT OR IGNORE INTO tags (id, name, createdAt, usedAt, system) VALUES (?, ?, ?, ?, 0)',
      id,
      name,
      now,
      now,
    )
  }

  // Generate file records
  console.log(`  Generating file records...`)
  const baseTime = Date.now() - 365 * 24 * 60 * 60 * 1000
  let fileIndex = 0
  let batchBuffer: Record<string, unknown>[] = []
  let objectBuffer: Record<string, unknown>[] = []
  let fsBuffer: Record<string, unknown>[] = []
  let tagBuffer: Record<string, unknown>[] = []
  let objectCount = 0
  let fsCount = 0

  async function flushBatch() {
    if (batchBuffer.length > 0) {
      await sql.insertMany(db, 'files', batchBuffer)
      batchBuffer = []
    }
    if (objectBuffer.length > 0) {
      await sql.insertMany(db, 'objects', objectBuffer)
      objectBuffer = []
    }
    if (fsBuffer.length > 0) {
      await sql.insertMany(db, 'fs', fsBuffer)
      fsBuffer = []
    }
    if (tagBuffer.length > 0) {
      await sql.insertMany(db, 'file_tags', tagBuffer)
      tagBuffer = []
    }
  }

  for (const { groups, versions } of dist) {
    for (let g = 0; g < groups; g++) {
      const groupName =
        versions === 1
          ? `file-${fileIndex}.jpg`
          : `vgroup-${versions}v-${g}.pdf`
      const dirSlot = g % 55
      const dirId = dirSlot < dirIds.length ? dirIds[dirSlot] : null

      for (let v = 0; v < versions; v++) {
        const id = `f-${fileIndex}`
        const typeIdx = fileIndex % TYPES.length
        const createdAt = baseTime + fileIndex * 1000
        const updatedAt = createdAt + v * 86400000
        const size = 1000 + (fileIndex % 100000) * 100

        const isCurrent = v === versions - 1 ? 1 : 0
        batchBuffer.push({
          id,
          name: groupName,
          size,
          createdAt,
          updatedAt,
          type: TYPES[typeIdx],
          kind: 'file',
          localId: null,
          hash: `hash-${fileIndex}`,
          addedAt: createdAt,
          thumbForId: null,
          thumbSize: null,
          directoryId: dirId,
          trashedAt: null,
          deletedAt: null,
          lostReason: null,
          current: isCurrent,
        })

        // 80% get objects
        if (fileIndex % 5 !== 0) {
          objectBuffer.push({
            fileId: id,
            indexerURL: INDEXER_URL,
            id: `obj-${fileIndex}`,
            slabs: '[]',
            encryptedDataKey: '',
            encryptedMetadataKey: '',
            encryptedMetadata: '',
            dataSignature: '',
            metadataSignature: '',
            createdAt,
            updatedAt,
          })
          objectCount++
        }

        // 30% get fs entries
        if (fileIndex % 10 < 3) {
          fsBuffer.push({
            fileId: id,
            size,
            addedAt: createdAt,
            usedAt: createdAt,
          })
          fsCount++
        }

        // Assign tags: each tag to ~15% of files
        for (let t = 0; t < tagIds.length; t++) {
          if ((fileIndex + t * 7) % 7 === 0) {
            tagBuffer.push({ fileId: id, tagId: tagIds[t] })
          }
        }

        fileIndex++

        if (batchBuffer.length >= BATCH_SIZE) {
          await flushBatch()
          if (fileIndex % 100_000 === 0) {
            console.log(
              `  ${fileIndex.toLocaleString()} / ${totalRecords.toLocaleString()} records`,
            )
          }
        }
      }
    }
  }

  await flushBatch()

  const generationTimeMs = Math.round(performance.now() - start)
  console.log(`  Dataset generated in ${(generationTimeMs / 1000).toFixed(1)}s`)

  return {
    totalRecords: fileIndex,
    currentFiles: getCurrentCount(dist),
    directories: dirCount,
    tags: tagCount,
    objectsPopulated: objectCount,
    fsPopulated: fsCount,
    generationTimeMs,
  }
}

export { INDEXER_URL }
