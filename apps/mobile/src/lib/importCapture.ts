import { logger } from '@siastorage/logger'
import { IMPORT_GRANT_RESERVE } from '../config/imports'
import type { Asset } from './assetImports'
import { stageFileForImport } from './importStaging'
import { SourceRefs } from './sourceRefs'

/**
 * Turns each import source's picks into import rows that survive a process
 * kill.
 *
 * Picker files get per-file OS bookmarks. iOS bookmarks only open-in-place
 * picks, because a bookmark over an expo `asCopy` tmp copy points at a file
 * iOS purges. Android's ACTION_OPEN_DOCUMENT results carry persistable
 * grants, so bookmarking is capped by the remaining grant budget minus a
 * reserve; the overflow imports as `ephemeral`.
 *
 * Shared files get a bookmark when grant-backed (content://), or move into
 * the staging dir when they are file:// container copies. Camera captures
 * are app-born temps, also moved into the staging dir.
 *
 * Every failure degrades to `ephemeral` and the pick still imports this
 * session: durability is best-effort, importability is not.
 */
export async function capturePickedAssets(
  picked: Asset[],
  opts: { openInPlace: boolean },
): Promise<Asset[]> {
  if (picked.length === 0) return picked

  let room: number
  if (opts.openInPlace) {
    // iOS open-in-place originals: no grant budget, bookmark every pick.
    room = picked.length
  } else {
    const remaining = await SourceRefs.grantBudgetRemaining()
    room = Math.max(0, remaining - IMPORT_GRANT_RESERVE)
    if (room < picked.length) {
      logger.info('importCapture', 'grant_budget_overflow', {
        picks: picked.length,
        room,
      })
    }
  }
  if (room === 0) return picked

  const toBookmark = picked.slice(0, room).filter((a) => !!a.sourceUri)
  const results = await SourceRefs.createFileBookmarks(toBookmark.map((a) => a.sourceUri!))
  const refByUri = new Map<string, string>()
  toBookmark.forEach((a, i) => {
    const result = results[i]
    if (result && 'ref' in result) {
      refByUri.set(a.sourceUri!, result.ref)
    } else {
      const code = result && 'code' in result ? result.code : 'unknown'
      // not-persistable is the provider declining, expected for some sources.
      const log = code === 'not-persistable' ? logger.debug : logger.warn
      log('importCapture', 'bookmark_create_failed', { code })
    }
  })

  return picked.map((a) => {
    const ref = a.sourceUri ? refByUri.get(a.sourceUri) : undefined
    return ref ? { ...a, sourceKind: 'bookmark' as const, sourceRef: ref } : a
  })
}

/** Share-sheet payloads: a grant-backed content:// uri gets a bookmark; a
 * file:// container copy moves into the staging dir. Failures stay
 * ephemeral but still import. */
export async function captureSharedFiles(files: Asset[]): Promise<Asset[]> {
  return Promise.all(
    files.map(async (file) => {
      if (!file.sourceUri) return file
      if (file.sourceUri.startsWith('content://')) {
        try {
          const ref = await SourceRefs.createFileBookmark(file.sourceUri)
          return { ...file, sourceKind: 'bookmark' as const, sourceRef: ref }
        } catch (e) {
          logger.debug('importCapture', 'share_bookmark_failed', { error: e as Error })
          return file
        }
      }
      const staged = await stageFileForImport(file.sourceUri)
      return staged ? { ...file, sourceKind: 'staged' as const, sourceUri: staged } : file
    }),
  )
}

/** Camera temps: app-born bytes, staged by rename so a kill can't purge them. */
export async function stageCameraAssets(assets: Asset[]): Promise<Asset[]> {
  return Promise.all(
    assets.map(async (asset) => {
      if (!asset.sourceUri) return asset
      const staged = await stageFileForImport(asset.sourceUri)
      return staged ? { ...asset, sourceKind: 'staged' as const, sourceUri: staged } : asset
    }),
  )
}
