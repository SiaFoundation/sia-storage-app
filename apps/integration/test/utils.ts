import * as crypto from 'crypto'
import * as nodeFs from 'fs'
import * as path from 'path'

export interface UploadState {
  id: string
  status: 'pending' | 'uploading' | 'complete' | 'error'
  progress: number
  size: number
  error?: string
  batchId?: string
  batchCount?: number
}

export interface TestFileInput {
  id: string
  name: string
  type: string
  size: number
  hash: string
  uri: string
}

export type TestFileFactory = (tempDir: string) => TestFileInput

export function generateTestFiles(
  count: number,
  options: {
    startId?: number
    sizeBytes?: number
    type?: 'data' | 'image' | 'video' | 'mixed'
  } = {},
): TestFileFactory[] {
  const { startId = 1, sizeBytes, type = 'data' } = options

  return Array.from({ length: count }, (_, i) => {
    const id = startId + i
    const isVideo = type === 'video' || (type === 'mixed' && i % 3 === 0)
    const isImage = type === 'image' || (type === 'mixed' && !isVideo)

    let ext: string
    let mimeType: string
    if (isVideo) {
      ext = '.mp4'
      mimeType = 'video/mp4'
    } else if (isImage) {
      ext = '.jpg'
      mimeType = 'image/jpeg'
    } else {
      ext = '.bin'
      mimeType = 'application/octet-stream'
    }

    const size = sizeBytes ?? 1024 * (id + 1)
    const fileId = `test-file-${id}`

    return (tempDir: string): TestFileInput => {
      const filePath = path.join(tempDir, `${fileId}${ext}`)
      const content = crypto.randomBytes(size)
      nodeFs.writeFileSync(filePath, content)
      const hash = crypto.createHash('sha256').update(content).digest('hex')
      return {
        id: fileId,
        name: `file-${id}${ext}`,
        type: mimeType,
        size,
        hash,
        uri: `file://${filePath}`,
      }
    }
  })
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function waitForCondition(
  fn: () => boolean | Promise<boolean>,
  opts: { timeout?: number; interval?: number; message?: string } = {},
): Promise<void> {
  const { timeout = 10_000, interval = 50, message } = opts
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await fn()) return
    await sleep(interval)
  }
  throw new Error(`${message ?? 'Condition'} not met within ${timeout}ms`)
}
