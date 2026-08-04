import { fileUriToPath } from '@siastorage/core/lib/fileUri'
import type { UploaderAdapters } from '@siastorage/core/services/uploader'

export function createNodeUploaderAdapters(): UploaderAdapters {
  return {
    toFilePath: fileUriToPath,

    progressScheduler(cb: () => void) {
      setImmediate(cb)
    },
  }
}
