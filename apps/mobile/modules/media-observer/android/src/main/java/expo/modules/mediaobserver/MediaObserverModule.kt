package expo.modules.mediaobserver

import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The photo library's insertion cursor, via MediaStore.
//
// `changesSince` returns the ids of images/videos added since a persisted
// cursor, so additions made while the app was not running are still reported. On
// API 30+ the cursor is MediaStore's monotonic generation — GENERATION_ADDED
// advances only on insert, so a metadata edit is not reported; below 30 it falls
// back to DATE_ADDED. Only the primary shared volume is observed (a removable SD
// card has its own generation counter), which covers the camera roll.
class MediaObserverModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MediaObserver")

    AsyncFunction("currentCursor") { currentCursor() }

    AsyncFunction("changesSince") { cursor: String? -> changesSince(cursor) }
  }

  private fun currentCursor(): String =
    if (hasGeneration()) "$VERSION:gen:${MediaStore.getGeneration(context(), VOLUME)}"
    else "$VERSION:date:${System.currentTimeMillis() / 1000}"

  private fun changesSince(cursor: String?): Map<String, Any> {
    val parsed = parse(cursor) ?: return anchor()
    val (mode, since) = parsed
    // A cursor minted in the other mode (OS upgraded across API 30) isn't
    // comparable; re-anchor.
    if ((mode == "gen") != hasGeneration()) return anchor()

    return try {
      if (mode == "gen") {
        // Read the authoritative "now" before querying so a row inserted mid-query
        // is reported again next tick rather than skipped.
        val now = MediaStore.getGeneration(context(), VOLUME)
        // A stored cursor above the current generation means the counter reset
        // (MediaProvider storage cleared); re-anchor rather than hide additions.
        if (since > now) return anchor()
        result(idsAddedSince("${MediaStore.MediaColumns.GENERATION_ADDED} > ?", since), "$VERSION:gen:$now")
      } else {
        val now = System.currentTimeMillis() / 1000
        // A stored cursor far in the future (clock skew) would hide later
        // additions until the clock caught up; re-anchor instead.
        if (since > now + DATE_SLOP) return anchor()
        result(idsAddedSince("${MediaStore.MediaColumns.DATE_ADDED} >= ?", since), "$VERSION:date:$now")
      }
    } catch (_: SecurityException) {
      throw CodedException("media-observer: media permission denied")
    }
  }

  private fun idsAddedSince(predicate: String, since: Long): List<String> {
    val uri = MediaStore.Files.getContentUri(if (hasGeneration()) VOLUME else "external")
    val ids = ArrayList<String>()
    context().contentResolver
      .query(uri, arrayOf(MediaStore.MediaColumns._ID), "$predicate AND $MEDIA_TYPE", arrayOf(since.toString()), null)
      ?.use { c ->
        val col = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
        while (c.moveToNext()) ids.add(c.getLong(col).toString())
      }
    return ids
  }

  private fun result(ids: List<String>, cursor: String): Map<String, Any> =
    // A delta this large is cheaper to reconcile via the archive than to marshal.
    if (ids.size > MAX_INSERTS) anchor()
    else mapOf("inserted" to ids.distinct(), "cursor" to cursor)

  private fun anchor(): Map<String, Any> = mapOf("inserted" to emptyList<String>(), "cursor" to currentCursor())

  private fun parse(cursor: String?): Pair<String, Long>? {
    val parts = cursor?.split(":", limit = 3) ?: return null
    if (parts.size != 3 || parts[0] != VERSION || (parts[1] != "gen" && parts[1] != "date")) return null
    return parts[1] to (parts[2].toLongOrNull() ?: return null)
  }

  private fun hasGeneration(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R

  private fun context(): Context =
    appContext.reactContext ?: throw CodedException("media-observer: react context unavailable")

  companion object {
    private const val VERSION = "v1"
    private const val MAX_INSERTS = 10_000
    private const val DATE_SLOP = 300L

    // VOLUME_EXTERNAL_PRIMARY is API 29+; used only on the generation path (30+).
    private val VOLUME: String
      get() = MediaStore.VOLUME_EXTERNAL_PRIMARY

    // Images (1) and videos (3) only — the media the photo sync ingests.
    private val MEDIA_TYPE =
      "${MediaStore.Files.FileColumns.MEDIA_TYPE} IN " +
        "(${MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE}, ${MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO})"
  }
}
