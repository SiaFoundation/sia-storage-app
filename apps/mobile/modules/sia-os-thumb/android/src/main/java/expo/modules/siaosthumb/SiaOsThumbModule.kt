package expo.modules.siaosthumb

import android.content.ContentUris
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

// Writes a system-cached MediaStore thumbnail to the app cache directory
// and resolves with the resulting file:// path. ContentResolver.loadThumbnail
// (API 29+) reads from MediaProvider's on-disk thumbnail cache; the system
// process handles decode and resize. The JPEG encode and write run on the
// AsyncFunction worker thread — no bytes cross the JS bridge.
//
// Returns null on API < 29 and on any failure — callers fall back to the
// in-process resize path.
class SiaOsThumbModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SiaOsThumb")

    AsyncFunction("getOsThumbnail") { localId: String, targetSize: Double ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@AsyncFunction null
      val context = appContext.reactContext ?: return@AsyncFunction null
      val uri = parseLocalId(localId) ?: return@AsyncFunction null

      val bitmap: Bitmap = try {
        context.contentResolver.loadThumbnail(
          uri,
          Size(targetSize.toInt(), targetSize.toInt()),
          null,
        )
      } catch (_: Exception) {
        return@AsyncFunction null
      }

      val cacheDir = File(context.cacheDir, "sia-os-thumb").apply { mkdirs() }
      val file = File(cacheDir, "${uri.lastPathSegment}-${targetSize.toInt()}-${UUID.randomUUID()}.jpg")
      try {
        FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
      } catch (_: Exception) {
        return@AsyncFunction null
      }

      mapOf(
        "uri" to Uri.fromFile(file).toString(),
        "width" to bitmap.width,
        "height" to bitmap.height,
        "mimeType" to "image/jpeg",
      )
    }
  }

  private fun parseLocalId(localId: String): Uri? {
    if (localId.startsWith("content://")) return Uri.parse(localId)
    val id = localId.toLongOrNull() ?: return null
    return ContentUris.withAppendedId(MediaStore.Files.getContentUri("external"), id)
  }
}
