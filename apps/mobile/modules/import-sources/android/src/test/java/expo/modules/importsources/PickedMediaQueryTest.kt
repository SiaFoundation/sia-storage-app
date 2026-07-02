package expo.modules.importsources

import android.content.ContentValues
import android.database.MatrixCursor
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class PickedMediaQueryTest {
  private val resolver =
    ApplicationProvider.getApplicationContext<android.content.Context>().contentResolver

  @Before
  fun registerProvider() {
    Robolectric.buildContentProvider(PickerProvider::class.java).create("picked-media")
  }

  @Test
  fun `maps display name, size, mime and taken date from the provider`() {
    val out = PickedMediaQuery.resolve(resolver, Uri.parse("content://picked-media/full"))
    assertEquals("content://picked-media/full", out["uri"])
    assertEquals("IMG_0001.jpg", out["name"])
    assertEquals(38004L, out["size"])
    assertEquals("image/jpeg", out["mimeType"])
    assertEquals(1_700_000_000_000L, out["lastModified"])
  }

  @Test
  fun `a provider that rejects DATE_TAKEN still yields the openable columns`() {
    val out = PickedMediaQuery.resolve(resolver, Uri.parse("content://picked-media/no-taken"))
    assertEquals("doc.pdf", out["name"])
    assertNull(out["lastModified"])
  }

  @Test
  fun `zero size and missing name map to null`() {
    val out = PickedMediaQuery.resolve(resolver, Uri.parse("content://picked-media/sparse"))
    assertNull(out["name"])
    assertNull(out["size"])
  }

  class PickerProvider : android.content.ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun query(
      uri: Uri,
      projection: Array<out String>?,
      selection: String?,
      selectionArgs: Array<out String>?,
      sortOrder: String?,
    ): MatrixCursor {
      val wantsTaken = projection?.contains(MediaStore.MediaColumns.DATE_TAKEN) == true
      if (wantsTaken && uri.lastPathSegment == "no-taken") {
        throw IllegalArgumentException("unknown column")
      }
      if (wantsTaken) {
        return MatrixCursor(arrayOf(MediaStore.MediaColumns.DATE_TAKEN)).apply {
          addRow(arrayOf(1_700_000_000_000L))
        }
      }
      val cursor = MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE))
      when (uri.lastPathSegment) {
        "full" -> cursor.addRow(arrayOf("IMG_0001.jpg", 38004L))
        "no-taken" -> cursor.addRow(arrayOf("doc.pdf", 120L))
        "sparse" -> cursor.addRow(arrayOf(null, 0L))
      }
      return cursor
    }

    override fun getType(uri: Uri): String = "image/jpeg"

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(
      uri: Uri,
      values: ContentValues?,
      selection: String?,
      selectionArgs: Array<out String>?,
    ): Int = 0
  }
}
