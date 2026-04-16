import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, unlink } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { detectMimeType, MAGIC_BYTES_LENGTH } from '@siastorage/core/lib/detectMimeType'
import { uniqueId } from '@siastorage/core/lib/uniqueId'
import type { CliApp } from '../app'

export type IngestResult = {
  id: string
  name: string
  size: number
  type: string
}

/**
 * Ingest a file from disk into the library: detect MIME, stream-copy into the
 * fsIO-managed location while computing a SHA-256, and create the file record.
 * Bounded memory regardless of source size.
 */
export async function ingestFile(
  app: CliApp,
  opts: { filePath: string; directory?: string; name?: string },
): Promise<IngestResult> {
  const absPath = resolve(opts.filePath)
  const fileName = opts.name ?? basename(absPath)
  const fileId = uniqueId()
  const now = Date.now()

  const type = await detectFileType(absPath, fileName)
  const targetPath = app.fsIO.uri(fileId, type)
  await app.fsIO.ensureDirectory()

  const { hash, size } = await streamCopyAndHash(absPath, targetPath)

  try {
    await app.service.files.create({
      id: fileId,
      name: fileName,
      size,
      createdAt: now,
      updatedAt: now,
      addedAt: now,
      type,
      kind: 'file',
      localId: null,
      hash,
      trashedAt: null,
      deletedAt: null,
    })

    if (opts.directory) {
      const dir = await app.service.directories.getOrCreateAtPath(opts.directory)
      await app.service.directories.moveFile(fileId, dir.id)
    }

    await app.service.fs.upsertMeta({ fileId, size, addedAt: now, usedAt: now })

    return { id: fileId, name: fileName, size, type }
  } catch (e) {
    // Roll back the on-disk copy if the DB write failed — otherwise we'd leak
    // an orphan file the rest of the system has no record of.
    await unlink(targetPath).catch(() => {})
    throw e
  }
}

/** Reads just the magic-byte prefix to determine MIME without loading the whole file. */
async function detectFileType(absPath: string, fileName: string): Promise<string> {
  const handle = await open(absPath, 'r')
  try {
    const buf = Buffer.alloc(MAGIC_BYTES_LENGTH)
    const { bytesRead } = await handle.read(buf, 0, MAGIC_BYTES_LENGTH, 0)
    return detectMimeType({ fileName, bytes: buf.subarray(0, bytesRead) })
  } finally {
    await handle.close()
  }
}

/** Pipes source → SHA-256 hasher + destination file in one pass. */
async function streamCopyAndHash(
  sourcePath: string,
  targetPath: string,
): Promise<{ hash: string; size: number }> {
  const hasher = createHash('sha256')
  let size = 0
  const source = createReadStream(sourcePath)
  source.on('data', (chunk: string | Buffer) => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    hasher.update(buf)
    size += buf.byteLength
  })
  // pipeline handles backpressure, error propagation, and stream cleanup.
  await pipeline(source, createWriteStream(targetPath))
  return { hash: hasher.digest('hex'), size }
}
