package expo.modules.importsources

import android.content.ContentResolver
import android.content.ContentUris
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import java.io.FileNotFoundException
import java.io.InputStream

/**
 * Reads MediaStore rows for the copier. Rows are addressed by id through
 * content:// URIs and the ContentResolver stream, never the deprecated DATA
 * column, so videos, scoped storage, and secondary volumes all behave
 * identically. Injectable so classification and hashing test on the plain
 * JVM.
 */
interface MediaSource {
  data class Row(val sizeBytes: Long?, val isPending: Boolean, val mime: String?)

  /** Null when no row is visible to this app. */
  fun queryRow(assetId: Long): Row?

  fun openStream(assetId: Long): InputStream

  /** Full READ_MEDIA_* vs only the Android 14 partial-access grant. */
  fun hasFullReadAccess(): Boolean
}

class ContentResolverMediaSource(
  private val resolver: ContentResolver,
  private val fullReadAccess: () -> Boolean,
) : MediaSource {
  companion object {
    // The projection must never contain MediaStore.MediaColumns.DATA.
    val PROJECTION = arrayOf(
      MediaStore.Files.FileColumns._ID,
      MediaStore.Files.FileColumns.SIZE,
      MediaStore.Files.FileColumns.IS_PENDING,
      MediaStore.Files.FileColumns.MIME_TYPE,
    )
  }

  private fun contentUri(assetId: Long): Uri =
    ContentUris.withAppendedId(MediaStore.Files.getContentUri("external"), assetId)

  override fun queryRow(assetId: Long): MediaSource.Row? {
    val args = Bundle().apply {
      putInt(MediaStore.QUERY_ARG_MATCH_PENDING, MediaStore.MATCH_INCLUDE)
    }
    resolver.query(contentUri(assetId), PROJECTION, args, null)?.use { cursor ->
      if (!cursor.moveToFirst()) return null
      val size = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE))
      val pending =
        cursor.getInt(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.IS_PENDING)) == 1
      val mime =
        cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MIME_TYPE))
      return MediaSource.Row(if (size > 0) size else null, pending, mime)
    }
    return null
  }

  override fun openStream(assetId: Long): InputStream =
    resolver.openInputStream(contentUri(assetId))
      ?: throw CodedError("deleted", "provider returned no stream for $assetId")

  override fun hasFullReadAccess(): Boolean = fullReadAccess()
}

object MediaAssetCopier {
  data class CopyResult(val size: Long, val sha256Hex: String, val mime: String, val variant: String)

  fun copy(
    source: MediaSource,
    assetId: String,
    destPath: String,
    copyId: String,
    registry: CopyRegistry = CopyRegistry.shared,
    chunkSize: Int = 65536,
    writeOverride: ((ByteArray, Int) -> Unit)? = null,
    onProgress: ((bytesCopied: Long, totalBytes: Long?) -> Unit)? = null,
  ): CopyResult {
    val id =
      assetId.toLongOrNull() ?: throw CodedError("deleted", "not a MediaStore id: $assetId")

    val row = source.queryRow(id)
    if (row == null) {
      // Under Android 14 partial access a non-selected asset is invisible,
      // not deleted; permission-denied backs off and heals when the user
      // widens the selection.
      if (!source.hasFullReadAccess()) {
        throw CodedError("permission-denied", "asset invisible under partial access")
      }
      throw CodedError("deleted", "no MediaStore row for $assetId")
    }
    if (row.isPending) {
      throw CodedError("source-pending", "asset is still being written")
    }

    val dest = java.io.File(SourceRefCodec.pathFromFileUriOrPath(destPath))
    val output = if (writeOverride == null) dest.outputStream() else null
    val sink = Sha256Sink()
    var size = 0L
    val buffer = ByteArray(chunkSize)

    fun cleanupAndThrow(error: Throwable): Nothing {
      try {
        output?.close()
      } catch (_: Exception) {}
      dest.delete()
      throw error
    }

    val input =
      try {
        source.openStream(id)
      } catch (e: CodedError) {
        cleanupAndThrow(e)
      } catch (e: FileNotFoundException) {
        cleanupAndThrow(CodedError("deleted", e.message ?: assetId))
      } catch (e: SecurityException) {
        cleanupAndThrow(CodedError("permission-denied", e.message ?: assetId))
      }

    input.use { stream ->
      while (true) {
        if (registry.isCancelled(copyId)) {
          cleanupAndThrow(CodedError("cancelled", "copy cancelled"))
        }
        val read =
          try {
            stream.read(buffer)
          } catch (e: Exception) {
            if (registry.isCancelled(copyId)) {
              cleanupAndThrow(CodedError("cancelled", "copy cancelled"))
            }
            cleanupAndThrow(mapIoError(e))
          }
        if (read < 0) break
        try {
          if (writeOverride != null) writeOverride(buffer, read) else output?.write(buffer, 0, read)
        } catch (e: Exception) {
          cleanupAndThrow(mapIoError(e))
        }
        sink.update(buffer, read)
        size += read
        // A cancelled copy must deliver nothing, not even a late progress
        // event from the in-flight iteration.
        if (!registry.isCancelled(copyId)) {
          onProgress?.invoke(size, row.sizeBytes)
        }
      }
    }

    if (registry.isCancelled(copyId)) {
      cleanupAndThrow(CodedError("cancelled", "copy cancelled"))
    }
    try {
      // close() flushes, so ENOSPC can surface here; map it to a coded error
      // and drop the partial.
      output?.close()
    } catch (e: Exception) {
      cleanupAndThrow(mapIoError(e))
    }
    return CopyResult(
      size, sink.finalizeHex(), row.mime ?: "application/octet-stream", "original")
  }

}
