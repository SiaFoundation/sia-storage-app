import type { AppService } from '../app/service'
import { ThumbSizes } from '../types/files'

/** Invalidates all cached thumbnail sizes and metadata for a given file. */
export async function invalidateThumbnailsForFileId(
  app: AppService,
  fileId: string,
) {
  await Promise.all([
    ...ThumbSizes.map((size) =>
      app.caches.thumbnails.best.invalidate(fileId, String(size)),
    ),
    app.caches.thumbnails.byFileId.invalidate(fileId),
  ])
}
