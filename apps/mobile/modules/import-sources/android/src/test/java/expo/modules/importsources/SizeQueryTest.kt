package expo.modules.importsources

import android.content.ContentValues
import android.database.MatrixCursor
import android.net.Uri
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
class SizeQueryTest {
  private val resolver =
    ApplicationProvider.getApplicationContext<android.content.Context>().contentResolver

  @Before
  fun registerProvider() {
    MediaSizeProvider.queryCount = 0
    Robolectric.buildContentProvider(MediaSizeProvider::class.java).create("media")
  }

  @Test
  fun `maps found sizes, missing ids and zero sizes to null`() {
    val out = SizeQuery.query(resolver, listOf("1", "2", "3", "not-a-number"))
    assertEquals(38004L, out["1"])
    assertNull(out["2"]) // row exists with SIZE=0 (pending), so unknown
    assertNull(out["3"]) // no MediaStore row, so unknown
    assertNull(out["not-a-number"]) // non-numeric id: unknown, never throws
    assertEquals(4, out.size)
  }

  @Test
  fun `chunks large id lists under the SQL parameter limit`() {
    val ids = (1L..1200L).map { it.toString() }
    SizeQuery.query(resolver, ids)
    // 1200 ids / 500 per chunk = 3 queries.
    assertEquals(3, MediaSizeProvider.queryCount)
  }

  class MediaSizeProvider : android.content.ContentProvider() {
    companion object {
      var queryCount = 0
    }

    override fun onCreate() = true

    override fun query(
      uri: Uri,
      projection: Array<String>?,
      selection: String?,
      selectionArgs: Array<String>?,
      sortOrder: String?,
    ): MatrixCursor {
      queryCount++
      val cursor = MatrixCursor(arrayOf("_id", "_size"))
      val requested = selectionArgs?.toSet() ?: emptySet()
      if ("1" in requested) cursor.addRow(arrayOf(1L, 38004L))
      if ("2" in requested) cursor.addRow(arrayOf(2L, 0L)) // pending row: size not final
      return cursor
    }

    override fun getType(uri: Uri) = null
    override fun insert(uri: Uri, values: ContentValues?) = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?) = 0
    override fun update(
      uri: Uri,
      values: ContentValues?,
      selection: String?,
      selectionArgs: Array<String>?,
    ) = 0
  }
}
