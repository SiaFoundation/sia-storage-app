package expo.modules.thumbnailer

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt

// Generates upright, downsampled thumbnails entirely in native code. BitmapFactory
// subsamples the decode (inSampleSize) so the full-resolution bitmap is never
// materialized, and we apply the EXIF orientation ourselves with a Matrix — so
// the result is deterministic regardless of what any platform decoder would do.
class ThumbnailerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Thumbnailer")

    // Encodes one thumbnail per entry in `maxSizes`, each capping the long edge
    // at that size. The source is decoded and oriented once at the largest size;
    // smaller sizes are scaled down from that result.
    AsyncFunction("image") { uri: String, maxSizes: List<Int> ->
      val longest = maxSizes.maxOrNull() ?: return@AsyncFunction emptyList<Map<String, Any>>()

      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      openStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }

      val options = BitmapFactory.Options().apply {
        inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, longest)
      }
      val decoded = openStream(uri).use { BitmapFactory.decodeStream(it, null, options) }
        ?: throw CodedException("Could not decode image: $uri")

      val orientation = openStream(uri).use {
        ExifInterface(it).getAttributeInt(
          ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      }
      val upright = applyOrientation(decoded, orientation)

      maxSizes.map { size -> encodeWebp(scale(upright, size)) }
    }

    // One frame at `timeMs`, scaled to fit within `maxSize`. The retriever returns
    // frames with the track rotation already applied.
    AsyncFunction("video") { uri: String, maxSize: Int, timeMs: Int ->
      val retriever = MediaMetadataRetriever()
      val frame = try {
        retriever.setDataSource(context(), Uri.parse(uri))
        val timeUs = timeMs.toLong() * 1000
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
          retriever.getScaledFrameAtTime(
            timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, maxSize, maxSize)
        } else {
          retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        }
      } finally {
        retriever.release()
      } ?: throw CodedException("Could not extract video frame: $uri")

      encodeWebp(scale(frame, maxSize))
    }
  }

  // Largest power-of-two subsample that still leaves the long edge >= maxSize, so
  // the decode reads at most ~2x the target rather than the full image.
  private fun sampleSize(width: Int, height: Int, maxSize: Int): Int {
    var sample = 1
    var longest = max(width, height)
    while (longest / 2 >= maxSize) {
      longest /= 2
      sample *= 2
    }
    return sample
  }

  private fun applyOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> matrix.apply { setRotate(90f); postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> matrix.apply { setRotate(270f); postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(270f)
      else -> return bitmap
    }
    val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    if (rotated != bitmap) bitmap.recycle()
    return rotated
  }

  private fun scale(bitmap: Bitmap, maxSize: Int): Bitmap {
    val longest = max(bitmap.width, bitmap.height)
    if (maxSize >= longest) return bitmap
    val ratio = maxSize.toDouble() / longest
    val width = (bitmap.width * ratio).roundToInt()
    val height = (bitmap.height * ratio).roundToInt()
    return Bitmap.createScaledBitmap(bitmap, width, height, true)
  }

  private fun encodeWebp(bitmap: Bitmap): Map<String, Any> {
    val file = File(context().cacheDir, "${UUID.randomUUID()}.webp")
    val format = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Bitmap.CompressFormat.WEBP_LOSSY
    } else {
      @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
    }
    FileOutputStream(file).use { bitmap.compress(format, 80, it) }
    return mapOf(
      "uri" to Uri.fromFile(file).toString(),
      "width" to bitmap.width,
      "height" to bitmap.height,
      "mimeType" to "image/webp",
    )
  }

  private fun context() =
    appContext.reactContext ?: throw CodedException("React context unavailable")

  private fun openStream(uri: String): InputStream {
    val parsed = Uri.parse(uri)
    // Handles file:// and content://; falls back to a bare filesystem path.
    return context().contentResolver.openInputStream(parsed)
      ?: File(parsed.path ?: uri).inputStream()
  }
}
