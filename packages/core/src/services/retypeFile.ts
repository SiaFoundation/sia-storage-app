import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { extFromMime } from '../lib/fileTypes'

/**
 * Changes a `files` row's type and moves its bytes together. Their path is
 * derived from the type, so a row naming an extension nothing sits at reads
 * as having no local copy, losing a file that never uploaded.
 *
 * DB first: the rename is the step that can fail, and rolling the row back
 * leaves the bytes findable for the next pass.
 *
 * Both writes preserve updatedAt. A type correction is nothing the user did,
 * and stamping it would make an older version of a file its newest, so that
 * version would become the current one on every device.
 */
export async function retypeFile(
  app: AppService,
  fileId: string,
  oldType: string,
  newType: string,
  opts?: { skipInvalidation?: boolean },
): Promise<string> {
  logger.info('retypeFile', 'retyping', { fileId, from: oldType, to: newType })
  const write = { updatedAt: 'preserve', skipInvalidation: opts?.skipInvalidation } as const
  await app.files.update({ id: fileId, type: newType }, write)
  if (extFromMime(oldType) === extFromMime(newType)) {
    return app.fs.uri({ id: fileId, type: newType })
  }
  try {
    const renamed = await app.fs.renameToType({ id: fileId, type: oldType }, newType)
    return renamed.uri
  } catch (e) {
    await app.files.update({ id: fileId, type: oldType }, write).catch(() => {})
    throw e
  }
}
