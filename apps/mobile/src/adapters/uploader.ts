import type { UploaderAdapters } from '@siastorage/core/app'
import { fileUriToPath } from '@siastorage/core/lib/fileUri'

export function createUploaderAdapters(): UploaderAdapters {
  return {
    toFilePath: fileUriToPath,
    progressScheduler: (cb) => requestAnimationFrame(cb),
  }
}
