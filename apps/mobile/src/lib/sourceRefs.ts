import { logger } from '@siastorage/logger'
import {
  createFileBookmark,
  createFileBookmarks,
  grantBudgetRemaining,
  type PickedFile,
  pickFiles,
  releaseGrant,
  type SourceRef,
  startAccess,
  type StartAccessResult,
  startAccessChild,
  stopAccess,
  stopAccessDir,
} from 'import-sources'

/**
 * Durable OS permission handles for import sources: iOS security-scoped
 * bookmarks and Android persistable grants, tagged `ios-bm:<b64>` /
 * `android-uri:<uri>`. Core never branches on platform; only this layer and
 * the native module interpret refs. Byte copying lives in importCopy; this
 * covers grants, scopes, folder access, and the picker.
 */

export const SourceRefs = {
  async createFileBookmark(uri: string): Promise<SourceRef> {
    return createFileBookmark(uri)
  },
  async createFileBookmarks(uris: string[]) {
    return createFileBookmarks(uris)
  },
  async startAccess(ref: SourceRef): Promise<StartAccessResult> {
    return startAccess(ref)
  },
  async startAccessChild(dirRef: SourceRef, key: string): Promise<{ uri: string }> {
    return startAccessChild(dirRef, key)
  },
  // Stop/release are best-effort and safe when nothing was acquired.
  async stopAccess(ref: SourceRef): Promise<void> {
    await stopAccess(ref)
  },
  async stopAccessDir(dirRef: SourceRef): Promise<void> {
    await stopAccessDir(dirRef)
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
