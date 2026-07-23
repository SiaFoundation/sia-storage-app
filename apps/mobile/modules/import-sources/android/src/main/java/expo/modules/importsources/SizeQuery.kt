package expo.modules.importsources

import android.content.ContentResolver
import android.provider.MediaStore

/**
 * Batched MediaStore SIZE lookup for `getSizes`. Metadata only, no file I/O,
 * present whether or not the bytes are local. Size is a hint for progress
 * totals and copy scheduling: rows the query can't see and 0-byte pending
 * rows map to null, and the copy itself re-measures the authoritative size.
 */
object SizeQuery {
  // Stay under SQLite's host-parameter limit with headroom.
  private const val CHUNK = 500

  fun query(resolver: ContentResolver, assetIds: List<String>): Map<String, Long?> {
    val out = HashMap<String, Long?>(assetIds.size)
    for (id in assetIds) out[id] = null
    val numeric = assetIds.mapNotNull { it.toLongOrNull() }
    for (chunk in numeric.chunked(CHUNK)) {
      val selection =
        "${MediaStore.Files.FileColumns._ID} IN (${chunk.joinToString(",") { "?" }})"
      resolver
        .query(
          MediaStore.Files.getContentUri("external"),
          arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.SIZE),
          selection,
          chunk.map { it.toString() }.toTypedArray(),
          null,
        )
        ?.use { c ->
          val idCol = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
          val sizeCol = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE)
          while (c.moveToNext()) {
            val size = c.getLong(sizeCol)
            out[c.getLong(idCol).toString()] = if (size > 0) size else null
          }
        }
    }
    return out
  }
}
