import {
  calculateFileProgress,
  calculateAllFileProgress,
  BatchInfo,
} from '../lib/uploadProgress'

describe('uploadProgress', () => {
  describe('calculateFileProgress', () => {
    it('all files in batch share the same progress', () => {
      const batch: BatchInfo = {
        files: [
          { fileId: 'a', size: 10 },
          { fileId: 'b', size: 40 },
          { fileId: 'c', size: 50 },
        ],
        totalSize: 100,
      }

      // All files show the same batch progress regardless of size
      expect(calculateFileProgress(batch, 0.05, 'a')).toBe(0.05)
      expect(calculateFileProgress(batch, 0.05, 'b')).toBe(0.05)
      expect(calculateFileProgress(batch, 0.05, 'c')).toBe(0.05)

      // At 50% batch progress, all files at 50%
      expect(calculateFileProgress(batch, 0.5, 'a')).toBe(0.5)
      expect(calculateFileProgress(batch, 0.5, 'b')).toBe(0.5)
      expect(calculateFileProgress(batch, 0.5, 'c')).toBe(0.5)

      // At 100% batch progress, all files done
      expect(calculateFileProgress(batch, 1.0, 'a')).toBe(1.0)
      expect(calculateFileProgress(batch, 1.0, 'b')).toBe(1.0)
      expect(calculateFileProgress(batch, 1.0, 'c')).toBe(1.0)
    })

    it('handles single file batch', () => {
      const batch: BatchInfo = {
        files: [{ fileId: 'single', size: 100 }],
        totalSize: 100,
      }

      expect(calculateFileProgress(batch, 0.0, 'single')).toBe(0)
      expect(calculateFileProgress(batch, 0.5, 'single')).toBe(0.5)
      expect(calculateFileProgress(batch, 1.0, 'single')).toBe(1.0)
    })

    it('handles equal size files - all show same progress', () => {
      const batch: BatchInfo = {
        files: [
          { fileId: 'a', size: 25 },
          { fileId: 'b', size: 25 },
          { fileId: 'c', size: 25 },
          { fileId: 'd', size: 25 },
        ],
        totalSize: 100,
      }

      // At 0%, all files at 0%
      expect(calculateFileProgress(batch, 0.0, 'a')).toBe(0)
      expect(calculateFileProgress(batch, 0.0, 'd')).toBe(0)

      // At 25%, all files at 25%
      expect(calculateFileProgress(batch, 0.25, 'a')).toBe(0.25)
      expect(calculateFileProgress(batch, 0.25, 'b')).toBe(0.25)
      expect(calculateFileProgress(batch, 0.25, 'c')).toBe(0.25)
      expect(calculateFileProgress(batch, 0.25, 'd')).toBe(0.25)

      // At 75%, all files at 75%
      expect(calculateFileProgress(batch, 0.75, 'a')).toBe(0.75)
      expect(calculateFileProgress(batch, 0.75, 'd')).toBe(0.75)
    })

    it('returns 0 for unknown file ID', () => {
      const batch: BatchInfo = {
        files: [{ fileId: 'known', size: 100 }],
        totalSize: 100,
      }

      expect(calculateFileProgress(batch, 0.5, 'unknown')).toBe(0)
    })

    it('handles file with zero size - still shows batch progress', () => {
      const batch: BatchInfo = {
        files: [
          { fileId: 'zero', size: 0 },
          { fileId: 'normal', size: 100 },
        ],
        totalSize: 100,
      }

      // Zero-size file shows same progress as batch
      expect(calculateFileProgress(batch, 0.5, 'zero')).toBe(0.5)
      expect(calculateFileProgress(batch, 0.5, 'normal')).toBe(0.5)
    })

    it('handles empty batch', () => {
      const batch: BatchInfo = {
        files: [],
        totalSize: 0,
      }

      expect(calculateFileProgress(batch, 0.5, 'any')).toBe(0)
    })
  })

  describe('calculateAllFileProgress', () => {
    it('returns same progress for all files', () => {
      const batch: BatchInfo = {
        files: [
          { fileId: 'a', size: 50 },
          { fileId: 'b', size: 50 },
        ],
        totalSize: 100,
      }

      const progress = calculateAllFileProgress(batch, 0.5)

      expect(progress).toEqual({
        a: 0.5,
        b: 0.5,
      })
    })

    it('all files share batch progress', () => {
      const batch: BatchInfo = {
        files: [
          { fileId: 'a', size: 50 },
          { fileId: 'b', size: 50 },
        ],
        totalSize: 100,
      }

      const progress = calculateAllFileProgress(batch, 0.75)

      expect(progress).toEqual({
        a: 0.75,
        b: 0.75,
      })
    })

    it('all files complete together at 100%', () => {
      const batch: BatchInfo = {
        files: [
          { fileId: 'a', size: 10 },
          { fileId: 'b', size: 40 },
          { fileId: 'c', size: 50 },
        ],
        totalSize: 100,
      }

      const progress = calculateAllFileProgress(batch, 1.0)

      expect(progress).toEqual({
        a: 1.0,
        b: 1.0,
        c: 1.0,
      })
    })
  })
})
