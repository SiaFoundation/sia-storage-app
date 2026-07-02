package expo.modules.importsources

import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class StreamCopierTest {
  @get:Rule val tmp = TemporaryFolder()

  private val resolver =
    ApplicationProvider.getApplicationContext<android.content.Context>().contentResolver

  @Test
  fun `copies a file source with a percent-encoded path and hashes in the same read`() {
    val payload = ByteArray(120_000) { (it % 255).toByte() }
    val dir = tmp.newFolder("with space")
    val source = File(dir, "src.bin").apply { writeBytes(payload) }
    val dest = File(tmp.root, "id.token.tmp")

    val sourceUri = "file://" + source.absolutePath.replace(" ", "%20")
    val result = StreamCopier.copy(resolver, sourceUri, dest.absolutePath)

    assertEquals(payload.size.toLong(), result.size)
    assertArrayEquals(payload, dest.readBytes())
    val expected = Sha256Sink().also { it.update(payload) }.finalizeHex()
    assertEquals(expected, result.sha256Hex)
    // destPath is written directly; no sibling temp file ever exists.
    assertArrayEquals(arrayOf("id.token.tmp", "with space"), tmp.root.list()!!.sortedArray())
  }

  @Test
  fun `streams a content source through the resolver`() {
    val payload = "content bytes".toByteArray()
    val uri = Uri.parse("content://test.provider/doc/1")
    shadowOf(resolver).registerInputStream(uri, ByteArrayInputStream(payload))
    val dest = File(tmp.root, "out.bin")

    val result = StreamCopier.copy(resolver, uri.toString(), dest.absolutePath)

    assertEquals(payload.size.toLong(), result.size)
    assertArrayEquals(payload, dest.readBytes())
  }

  @Test
  fun `sniffs magic bytes when the source has no metadata authority`() {
    // JPEG magic in an extensionless file:// source, no provider mime at all.
    val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte()) + ByteArray(64)
    val source = File(tmp.root, "noext").apply { writeBytes(jpeg) }
    val dest = File(tmp.root, "out.bin")

    assertEquals("image/jpeg", StreamCopier.copy(resolver, source.absolutePath, dest.absolutePath).mime)
  }

  @Test
  fun `a specific provider mime is authoritative over the sniff`() {
    // PNG magic in the bytes, but the provider says webp; the provider wins.
    Robolectric.buildContentProvider(WebpProvider::class.java).create("typed.provider")
    val png = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47) + ByteArray(16)
    val uri = Uri.parse("content://typed.provider/doc/2")
    shadowOf(resolver).registerInputStream(uri, ByteArrayInputStream(png))
    val dest = File(tmp.root, "out2.bin")

    assertEquals("image/webp", StreamCopier.copy(resolver, uri.toString(), dest.absolutePath).mime)
  }

  class WebpProvider : android.content.ContentProvider() {
    override fun onCreate() = true
    override fun getType(uri: Uri) = "image/webp"
    override fun query(u: Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?) = null
    override fun insert(u: Uri, v: android.content.ContentValues?) = null
    override fun delete(u: Uri, s: String?, a: Array<String>?) = 0
    override fun update(u: Uri, v: android.content.ContentValues?, s: String?, a: Array<String>?) = 0
  }

  @Test
  fun `a missing source classifies deleted`() {
    val dest = File(tmp.root, "out.bin")
    val error = assertThrows(CodedError::class.java) {
      StreamCopier.copy(resolver, File(tmp.root, "missing.bin").absolutePath, dest.absolutePath)
    }
    assertEquals("deleted", error.code)
    assertFalse(dest.exists())
  }

  @Test
  fun `enospc mid-stream classifies not-enough-space and deletes the partial`() {
    val source = File(tmp.root, "src.bin").apply { writeBytes(ByteArray(300_000)) }
    val dest = File(tmp.root, "out.bin")
    dest.writeBytes(ByteArray(4)) // pre-seed so the delete-on-failure is observable

    var written = 0
    val error = assertThrows(CodedError::class.java) {
      StreamCopier.copy(
        resolver, source.absolutePath, dest.absolutePath, chunkSize = 65536,
        writeOverride = { _, length ->
          written += length
          if (written > 100_000) throw IOException("write failed: No space left on device")
        })
    }
    assertEquals("not-enough-space", error.code)
    assertFalse(dest.exists())
  }
}
