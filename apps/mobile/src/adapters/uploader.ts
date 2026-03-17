import type { UploaderAdapters } from '@siastorage/core/app'
import { createFileReader } from '../lib/fileReader'

export function createUploaderAdapters(): UploaderAdapters {
  return {
    createFileReader: (uri) => createFileReader(uri),
    progressScheduler: (cb) => requestAnimationFrame(cb),
  }
}
