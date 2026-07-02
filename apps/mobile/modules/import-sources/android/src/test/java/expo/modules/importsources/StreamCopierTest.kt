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
  fun `returns the first 32 bytes as headBytes from the copy's one read`() {
    val payload = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte()) + ByteArray(64) { it.toByte() }
    val source = File(tmp.root, "noext").apply { writeBytes(payload) }
    val dest = File(tmp.root, "out.bin")

    val result = StreamCopier.copy(resolver, source.absolutePath, dest.absolutePath)
    assertArrayEquals(payload.copyOf(StreamCopier.HEAD_BYTE_COUNT), result.headBytes)
  }

  @Test
  fun `headBytes accumulates to the full window across short provider reads`() {
    // A content stream may return a few bytes per read; the head window must
    // fill across reads, not stop at the first.
    val payload = ByteArray(64) { it.toByte() }
    val uri = Uri.parse("content://test.provider/doc/3")
    shadowOf(resolver).registerInputStream(uri, DribbleInputStream(payload, 5))
    val dest = File(tmp.root, "out3.bin")

    val result = StreamCopier.copy(resolver, uri.toString(), dest.absolutePath)
    assertArrayEquals(payload.copyOf(StreamCopier.HEAD_BYTE_COUNT), result.headBytes)
    assertArrayEquals(payload, dest.readBytes())
  }

  @Test
  fun `a file shorter than the head window returns its whole content as headBytes`() {
    val payload = byteArrayOf(0x25, 0x50, 0x44, 0x46)
    val source = File(tmp.root, "tiny.pdf").apply { writeBytes(payload) }
    val dest = File(tmp.root, "tiny.out")

    val result = StreamCopier.copy(resolver, source.absolutePath, dest.absolutePath)
    assertArrayEquals(payload, result.headBytes)
  }

  // Returns at most `perRead` bytes per read() call.
  class DribbleInputStream(private val data: ByteArray, private val perRead: Int) :
    java.io.InputStream() {
    private var pos = 0
    override fun read(): Int = if (pos < data.size) data[pos++].toInt() and 0xFF else -1
    override fun read(b: ByteArray, off: Int, len: Int): Int {
      if (pos >= data.size) return -1
      val n = minOf(perRead, len, data.size - pos)
      System.arraycopy(data, pos, b, off, n)
      pos += n
      return n
    }
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
