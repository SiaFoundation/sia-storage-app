package expo.modules.importsources

import android.content.ContentResolver
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns

/**
 * Metadata for a picked media uri, read without opening the stream. Every
 * openable provider must honor OpenableColumns; DATE_TAKEN exists only on
 * media providers, so it is probed in a separate query and a provider that
 * rejects the column yields null instead of failing the pick.
 */
object PickedMediaQuery {
  fun resolve(resolver: ContentResolver, uri: Uri): Map<String, Any?> {
    var name: String? = null
    var size: Long? = null
    resolver
      .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
      ?.use { c ->
        if (c.moveToFirst()) {
          val nameCol = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          val sizeCol = c.getColumnIndex(OpenableColumns.SIZE)
          if (nameCol >= 0 && !c.isNull(nameCol)) name = c.getString(nameCol)
          // 0 means pending or unknown, same convention as SizeQuery.
          if (sizeCol >= 0 && !c.isNull(sizeCol)) size = c.getLong(sizeCol).takeIf { it > 0 }
        }
      }
    val taken =
      try {
        resolver
          .query(uri, arrayOf(MediaStore.MediaColumns.DATE_TAKEN), null, null, null)
          ?.use { c ->
            val col = c.getColumnIndex(MediaStore.MediaColumns.DATE_TAKEN)
            if (c.moveToFirst() && col >= 0 && !c.isNull(col)) c.getLong(col).takeIf { it > 0 }
            else null
          }
      } catch (_: Exception) {
        null
      }
    return mapOf(
      "uri" to uri.toString(),
      "name" to name,
      "size" to size,
      "mimeType" to resolver.getType(uri),
      "lastModified" to taken,
    )
  }
}
