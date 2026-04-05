/**
 * Node.js thumbnail generation using sharp.
 *
 * Provides the same functionality as expo-image-manipulator for tests,
 * using the sharp library which uses the same algorithms (libvips).
 */

import * as path from 'path'
import sharp from 'sharp'

// Temp directory for generated thumbnails - defaults to system temp
let tempDir: string | null = null

export function setTempDirectory(dir: string): void {
  tempDir = dir
}

export function getTempDirectory(): string {
  if (!tempDir) {
    // Use system temp directory as fallback
    const os = require('os')
    tempDir = os.tmpdir() as string
  }
  return tempDir as string
}

/**
 * Get image dimensions using sharp
 */
export async function getImageSize(uri: string): Promise<{ width: number; height: number } | null> {
  try {
    const filePath = uriToPath(uri)
    const metadata = await sharp(filePath).metadata()
    if (metadata.width && metadata.height) {
      return { width: metadata.width, height: metadata.height }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Mock ImageManipulator that uses sharp
 */
export class NodeImageManipulator {
  private imagePath: string
  private operations: Array<{ type: string; params: unknown }> = []

  constructor(uri: string) {
    this.imagePath = uriToPath(uri)
  }

  resize(params: { width?: number; height?: number }): this {
    this.operations.push({ type: 'resize', params })
    return this
  }

  async renderAsync(): Promise<NodeImageRef> {
    let pipeline = sharp(this.imagePath)

    for (const op of this.operations) {
      if (op.type === 'resize') {
        const { width, height } = op.params as {
          width?: number
          height?: number
        }
        pipeline = pipeline.resize(width, height, { fit: 'inside' })
      }
    }

    return new NodeImageRef(pipeline)
  }

  static manipulate(uri: string): NodeImageManipulator {
    return new NodeImageManipulator(uri)
  }
}

class NodeImageRef {
  private pipeline: sharp.Sharp

  constructor(pipeline: sharp.Sharp) {
    this.pipeline = pipeline
  }

  async saveAsync(options: {
    compress?: number
    format?: 'webp' | 'jpeg' | 'png'
  }): Promise<{ uri: string; width: number; height: number }> {
    const dir = getTempDirectory()
    const filename = `thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.webp`
    const outputPath = path.join(dir, filename)

    const quality = Math.round((options.compress ?? 0.8) * 100)

    // Convert to webp with quality setting
    const result = await this.pipeline.webp({ quality }).toFile(outputPath)

    return {
      uri: pathToUri(outputPath),
      width: result.width,
      height: result.height,
    }
  }
}

/**
 * Mock VideoThumbnails - for now just returns a placeholder
 * In a real implementation, could use ffmpeg
 */
export async function getVideoThumbnail(
  uri: string,
  _options: { time?: number; quality?: number },
): Promise<{ uri: string; width: number; height: number }> {
  // For video thumbnails in tests, we'd need ffmpeg
  // For now, return a simple placeholder or throw
  throw new Error('Video thumbnail generation not supported in tests')
}

// Helper to convert file:// URI to path
function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return uri.slice(7)
  }
  return uri
}

// Helper to convert path to file:// URI
function pathToUri(filePath: string): string {
  if (filePath.startsWith('file://')) {
    return filePath
  }
  return `file://${filePath}`
}

/**
 * Export format for compatibility
 */
export const SaveFormat = {
  WEBP: 'webp' as const,
  JPEG: 'jpeg' as const,
  PNG: 'png' as const,
}

/**
 * Main export - matches expo-image-manipulator interface
 */
export const ImageManipulator = {
  manipulate: (uri: string) => NodeImageManipulator.manipulate(uri),
}
