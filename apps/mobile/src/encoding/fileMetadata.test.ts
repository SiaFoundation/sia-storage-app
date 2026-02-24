import type { FileMetadata } from '../stores/files'
import {
  decodeFileMetadata,
  encodeFileMetadata,
  hasCompleteFileMetadata,
  hasCompleteThumbnailMetadata,
  MAX_SUPPORTED_VERSION,
} from './fileMetadata'

jest.mock('@siastorage/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

const { logger } = require('@siastorage/logger') as jest.Mocked<any>

function encode(obj: Record<string, unknown>): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(obj)).buffer as ArrayBuffer
}

const baseFile: FileMetadata = {
  id: 'file-1',
  name: 'photo.jpg',
  type: 'image/jpeg',
  kind: 'file',
  size: 1024,
  hash: 'abc123',
  createdAt: 1000,
  updatedAt: 2000,
}

const baseThumb: FileMetadata = {
  id: 'thumb-1',
  name: 'photo.jpg',
  type: 'image/jpeg',
  kind: 'thumb',
  size: 512,
  hash: 'thumb-hash',
  thumbForId: 'file-1',
  thumbSize: 64,
  createdAt: 1000,
  updatedAt: 2000,
}

describe('fileMetadata', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('MAX_SUPPORTED_VERSION', () => {
    it('is 1', () => {
      expect(MAX_SUPPORTED_VERSION).toBe(1)
    })
  })

  describe('encodeFileMetadata', () => {
    it('encodes a v1 file', () => {
      const buf = encodeFileMetadata(baseFile)
      const decoded = JSON.parse(new TextDecoder().decode(buf))
      expect(decoded).toEqual({
        version: 1,
        id: 'file-1',
        name: 'photo.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 1024,
        hash: 'abc123',
        createdAt: 1000,
        updatedAt: 2000,
      })
    })

    it('encodes a v1 thumbnail with thumbForId', () => {
      const buf = encodeFileMetadata(baseThumb)
      const decoded = JSON.parse(new TextDecoder().decode(buf))
      expect(decoded).toEqual({
        version: 1,
        id: 'thumb-1',
        name: 'photo.jpg',
        type: 'image/jpeg',
        kind: 'thumb',
        size: 512,
        hash: 'thumb-hash',
        thumbForId: 'file-1',
        thumbSize: 64,
        createdAt: 1000,
        updatedAt: 2000,
      })
    })

    it('includes thumbForHash for backwards compatibility when provided', () => {
      const buf = encodeFileMetadata(baseThumb, { thumbForHash: 'parent-hash' })
      const decoded = JSON.parse(new TextDecoder().decode(buf))
      expect(decoded.thumbForHash).toBe('parent-hash')
      expect(decoded.thumbForId).toBe('file-1')
    })

    it('omits thumbForHash when not provided for thumbnails', () => {
      const buf = encodeFileMetadata(baseThumb)
      const decoded = JSON.parse(new TextDecoder().decode(buf))
      expect(decoded.thumbForHash).toBeUndefined()
    })

    it('omits thumb fields for files', () => {
      const buf = encodeFileMetadata(baseFile)
      const decoded = JSON.parse(new TextDecoder().decode(buf))
      expect(decoded.thumbForId).toBeUndefined()
      expect(decoded.thumbSize).toBeUndefined()
      expect(decoded.thumbForHash).toBeUndefined()
    })

    it('always writes version: 1', () => {
      const buf = encodeFileMetadata(baseFile)
      const decoded = JSON.parse(new TextDecoder().decode(buf))
      expect(decoded.version).toBe(1)
    })
  })

  describe('decodeFileMetadata', () => {
    describe('v1 format', () => {
      it('decodes a v1 file', () => {
        const buf = encodeFileMetadata(baseFile)
        const result = decodeFileMetadata(buf)
        expect(result).toEqual({
          id: 'file-1',
          name: 'photo.jpg',
          type: 'image/jpeg',
          kind: 'file',
          size: 1024,
          hash: 'abc123',
          createdAt: 1000,
          updatedAt: 2000,
        })
      })

      it('decodes a v1 thumbnail with thumbForId', () => {
        const buf = encodeFileMetadata(baseThumb)
        const result = decodeFileMetadata(buf)
        expect(result).toEqual({
          id: 'thumb-1',
          name: 'photo.jpg',
          type: 'image/jpeg',
          kind: 'thumb',
          size: 512,
          hash: 'thumb-hash',
          thumbForId: 'file-1',
          thumbSize: 64,
          createdAt: 1000,
          updatedAt: 2000,
        })
      })

      it('preserves thumbForHash when present in v1 thumb metadata', () => {
        const buf = encodeFileMetadata(baseThumb, {
          thumbForHash: 'parent-hash',
        })
        const result = decodeFileMetadata(buf)
        expect(result.thumbForHash).toBe('parent-hash')
        expect(result.thumbForId).toBe('file-1')
      })
    })

    describe('v0 format (no version field)', () => {
      it('decodes a v0 file', () => {
        const buf = encode({
          name: 'old.jpg',
          type: 'image/jpeg',
          size: 500,
          hash: 'v0-hash',
          createdAt: 100,
          updatedAt: 200,
        })
        const result = decodeFileMetadata(buf)
        expect(result).toEqual({
          id: '',
          name: 'old.jpg',
          type: 'image/jpeg',
          kind: 'file',
          size: 500,
          hash: 'v0-hash',
          createdAt: 100,
          updatedAt: 200,
          thumbForHash: undefined,
          thumbForId: undefined,
          thumbSize: undefined,
        })
      })

      it('decodes a v0 thumbnail (has thumbForHash)', () => {
        const buf = encode({
          name: 'old.jpg',
          type: 'image/jpeg',
          size: 200,
          hash: 'v0-thumb',
          thumbForHash: 'v0-parent',
          thumbSize: 512,
          createdAt: 100,
          updatedAt: 200,
        })
        const result = decodeFileMetadata(buf)
        expect(result.kind).toBe('thumb')
        expect(result.thumbForHash).toBe('v0-parent')
        expect(result.thumbForId).toBeUndefined()
        expect(result.thumbSize).toBe(512)
        expect(result.id).toBe('')
      })
    })

    describe('future version (version > MAX_SUPPORTED_VERSION)', () => {
      it('parses known fields from a future version', () => {
        const buf = encode({
          version: 99,
          id: 'future-1',
          name: 'future.jpg',
          type: 'image/jpeg',
          kind: 'file',
          size: 2048,
          hash: 'future-hash',
          createdAt: 3000,
          updatedAt: 4000,
          newFieldV99: 'ignored',
        })
        const result = decodeFileMetadata(buf)
        expect(result.id).toBe('future-1')
        expect(result.name).toBe('future.jpg')
        expect(result.kind).toBe('file')
        expect(result.hash).toBe('future-hash')
      })

      it('logs a warning for future versions', () => {
        const buf = encode({
          version: 5,
          id: 'f5',
          name: 'f.jpg',
          type: 'image/jpeg',
          kind: 'file',
          size: 1,
          hash: 'h',
          createdAt: 1,
          updatedAt: 1,
        })
        decodeFileMetadata(buf)
        expect(logger.warn).toHaveBeenCalledWith(
          'fileMetadata',
          'version_exceeds_max',
          expect.objectContaining({ version: 5, max: MAX_SUPPORTED_VERSION }),
        )
      })

      it('falls back to defaults for missing fields in future version', () => {
        const buf = encode({ version: 10 })
        const result = decodeFileMetadata(buf)
        expect(result.id).toBe('')
        expect(result.name).toBe('')
        expect(result.kind).toBe('file')
        expect(result.size).toBe(0)
        expect(result.hash).toBe('')
      })

      it('handles a future-version thumbnail', () => {
        const buf = encode({
          version: 3,
          id: 'ft-1',
          name: 't.jpg',
          type: 'image/jpeg',
          kind: 'thumb',
          size: 100,
          hash: 'fth',
          thumbForId: 'fp-1',
          thumbForHash: 'fph',
          thumbSize: 512,
          createdAt: 1,
          updatedAt: 2,
        })
        const result = decodeFileMetadata(buf)
        expect(result.kind).toBe('thumb')
        expect(result.thumbForId).toBe('fp-1')
        expect(result.thumbForHash).toBe('fph')
        expect(result.thumbSize).toBe(512)
      })
    })

    describe('error handling', () => {
      it('returns empty metadata for undefined buffer', () => {
        const result = decodeFileMetadata(undefined)
        expect(result).toEqual(expect.objectContaining({ id: '', hash: '' }))
      })

      it('returns empty metadata for empty buffer', () => {
        const result = decodeFileMetadata(new ArrayBuffer(0))
        expect(result).toEqual(expect.objectContaining({ id: '', hash: '' }))
      })

      it('returns empty metadata for invalid JSON', () => {
        const buf = new TextEncoder().encode('not json').buffer as ArrayBuffer
        const result = decodeFileMetadata(buf)
        expect(result).toEqual(expect.objectContaining({ id: '', hash: '' }))
        expect(logger.error).toHaveBeenCalled()
      })
    })

    describe('round-trip: encode → decode', () => {
      it('file round-trips cleanly', () => {
        const encoded = encodeFileMetadata(baseFile)
        const decoded = decodeFileMetadata(encoded)
        expect(decoded).toEqual({
          id: baseFile.id,
          name: baseFile.name,
          type: baseFile.type,
          kind: baseFile.kind,
          size: baseFile.size,
          hash: baseFile.hash,
          createdAt: baseFile.createdAt,
          updatedAt: baseFile.updatedAt,
        })
      })

      it('thumbnail round-trips cleanly', () => {
        const encoded = encodeFileMetadata(baseThumb, {
          thumbForHash: 'parent-hash',
        })
        const decoded = decodeFileMetadata(encoded)
        expect(decoded.id).toBe(baseThumb.id)
        expect(decoded.kind).toBe('thumb')
        expect(decoded.thumbForId).toBe(baseThumb.thumbForId)
        expect(decoded.thumbForHash).toBe('parent-hash')
        expect(decoded.thumbSize).toBe(baseThumb.thumbSize)
      })
    })
  })

  describe('hasCompleteFileMetadata', () => {
    it('returns true for complete file metadata', () => {
      const buf = encodeFileMetadata(baseFile)
      expect(hasCompleteFileMetadata(decodeFileMetadata(buf))).toBe(true)
    })

    it('returns false for empty metadata', () => {
      expect(hasCompleteFileMetadata(decodeFileMetadata(undefined))).toBe(false)
    })

    it('returns false when hash is missing', () => {
      const buf = encode({
        version: 1,
        id: 'x',
        name: 'x.jpg',
        type: 'image/jpeg',
        kind: 'file',
        size: 1,
        hash: '',
        createdAt: 1,
        updatedAt: 1,
      })
      expect(hasCompleteFileMetadata(decodeFileMetadata(buf))).toBe(false)
    })
  })

  describe('hasCompleteThumbnailMetadata', () => {
    it('returns true for complete v1 thumbnail', () => {
      const buf = encodeFileMetadata(baseThumb)
      expect(hasCompleteThumbnailMetadata(decodeFileMetadata(buf))).toBe(true)
    })

    it('returns true for v0 thumbnail with thumbForHash', () => {
      const buf = encode({
        name: 't.jpg',
        type: 'image/jpeg',
        size: 100,
        hash: 'th',
        thumbForHash: 'parent-h',
        thumbSize: 64,
        createdAt: 1,
        updatedAt: 1,
      })
      expect(hasCompleteThumbnailMetadata(decodeFileMetadata(buf))).toBe(true)
    })

    it('returns false for file metadata', () => {
      const buf = encodeFileMetadata(baseFile)
      expect(hasCompleteThumbnailMetadata(decodeFileMetadata(buf))).toBe(false)
    })

    it('returns false when thumbSize is missing', () => {
      const buf = encode({
        version: 1,
        id: 'x',
        name: 'x.jpg',
        type: 'image/jpeg',
        kind: 'thumb',
        size: 1,
        hash: 'h',
        thumbForId: 'pid',
        createdAt: 1,
        updatedAt: 1,
      })
      expect(hasCompleteThumbnailMetadata(decodeFileMetadata(buf))).toBe(false)
    })
  })
})
