package expo.modules.importsources

import android.content.ContentResolver
import android.net.Uri
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream

/**
 * Copy for `copyToPath` that hashes in the same read: one pass produces both
 * the bytes on disk and the SHA-256. Writes destPath directly; the caller
 * supplies the claim-scoped temp path and owns atomic publication. The
 * partial dest is deleted on any failure or cancellation. `content://`
 * sources stream through the ContentResolver, never a filesystem-path
 * assumption.
 */
object StreamCopier {
  // headBytes: the file's first bytes (up to 32), captured across reads. Type
  // classification is the JS side's job; native only saves it a read.
  data class CopyResult(val size: Long, val sha256Hex: String, val headBytes: ByteArray)

  const val HEAD_BYTE_COUNT = 32

  fun copy(
    resolver: ContentResolver?,
    srcUri: String,
    destPath: String,
    copyId: String? = null,
    registry: CopyRegistry = CopyRegistry.shared,
    chunkSize: Int = 65536,
    // Injectable for fail-mid-stream tests; production writes the dest stream.
    writeOverride: ((ByteArray, Int) -> Unit)? = null,
    onBytes: ((Long) -> Unit)? = null,
  ): CopyResult {
    val input: InputStream
    try {
      if (srcUri.startsWith("content://")) {
        val resolverRequired =
          resolver ?: throw CodedError("io-error", "no resolver for content uri")
        input =
          resolverRequired.openInputStream(Uri.parse(srcUri))
            ?: throw CodedError("deleted", "provider returned no stream: $srcUri")
      } else {
        input = FileInputStream(SourceRefCodec.pathFromFileUriOrPath(srcUri))
      }
    } catch (e: CodedError) {
      throw e
    } catch (e: FileNotFoundException) {
      throw CodedError("deleted", e.message ?: srcUri)
    } catch (e: SecurityException) {
      throw CodedError("permission-denied", e.message ?: srcUri)
    } catch (e: IOException) {
      throw CodedError("io-error", e.message ?: srcUri)
    }

    val dest = File(SourceRefCodec.pathFromFileUriOrPath(destPath))
    val output = if (writeOverride == null) dest.outputStream() else null
    val sink = Sha256Sink()
    var size = 0L
    val buffer = ByteArray(chunkSize)
    // The head window accumulates across reads: a content:// stream may
    // legally return only a few bytes on its first read.
    val head = ByteArray(HEAD_BYTE_COUNT)
    var headLen = 0

    fun cleanupAndThrow(error: Throwable): Nothing {
      try {
        output?.close()
      } catch (_: IOException) {}
      dest.delete()
      throw error
    }

    input.use { source ->
      while (true) {
        if (copyId != null && registry.isCancelled(copyId)) {
          cleanupAndThrow(CodedError("cancelled", "copy cancelled"))
        }
        val read =
          try {
            source.read(buffer)
          } catch (e: IOException) {
            // A stream closed by cancellation is a cancel, not an io failure.
            if (copyId != null && registry.isCancelled(copyId)) {
              cleanupAndThrow(CodedError("cancelled", "copy cancelled"))
            }
            cleanupAndThrow(mapIoError(e))
          }
        if (read < 0) break
        try {
          if (writeOverride != null) {
            writeOverride(buffer, read)
          } else {
            output?.write(buffer, 0, read)
          }
        } catch (e: Exception) {
          cleanupAndThrow(mapIoError(e))
        }
        sink.update(buffer, read)
        if (headLen < head.size && read > 0) {
          val n = minOf(read, head.size - headLen)
          System.arraycopy(buffer, 0, head, headLen, n)
          headLen += n
        }
        size += read
        if (copyId == null || !registry.isCancelled(copyId)) {
          onBytes?.invoke(size)
        }
      }
    }

    if (copyId != null && registry.isCancelled(copyId)) {
      cleanupAndThrow(CodedError("cancelled", "copy cancelled"))
    }
    try {
      // close() flushes, so ENOSPC can surface here; it must leave neither a
      // partial dest nor an un-coded exception.
      output?.close()
    } catch (e: IOException) {
      cleanupAndThrow(mapIoError(e))
    }
    return CopyResult(size, sink.finalizeHex(), head.copyOf(headLen))
  }

}
