import { logger } from '@siastorage/logger'
import {
  createFileBookmark,
  createFileBookmarks,
  grantBudgetRemaining,
  type PickedFile,
  pickFiles,
  releaseGrant,
  type SourceRef,
} from 'import-sources'

/**
 * Durable OS permission handles for import sources: iOS security-scoped
 * bookmarks and Android persistable grants, tagged `ios-bm:<b64>` /
 * `android-uri:<uri>`. Core never branches on platform; only this layer and
 * the native module interpret refs. Byte copying lives in importCopy; this
 * covers grants and the picker.
 */

export const SourceRefs = {
  async createFileBookmark(uri: string): Promise<SourceRef> {
    return createFileBookmark(uri)
  },
  async createFileBookmarks(uris: string[]) {
    return createFileBookmarks(uris)
  },
  async releaseGrant(ref: SourceRef): Promise<void> {
    try {
      await releaseGrant(ref)
    } catch (e) {
      logger.warn('sourceRefs', 'release_grant_failed', { error: e as Error })
    }
  },
  grantBudgetRemaining(): Promise<number> {
    return grantBudgetRemaining()
  },
}

/**
 * Present the native open-in-place picker (iOS). Returns the user's original
 * files, so bookmarks are created against real paths and no bytes are copied
 * at pick time. Dismissal resolves to an empty array; the module maps the
 * cancelled code.
 */
export async function pickFilesOpenInPlace(): Promise<PickedFile[]> {
  return pickFiles()
}
