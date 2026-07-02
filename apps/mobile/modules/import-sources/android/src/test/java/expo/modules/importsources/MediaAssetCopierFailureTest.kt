package expo.modules.importsources

import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class MediaAssetCopierFailureTest {
  @get:Rule val tmp = TemporaryFolder()

  private fun source(bytes: ByteArray, size: Long? = null) = object : MediaSource {
    override fun queryRow(assetId: Long) =
      MediaSource.Row(sizeBytes = size, isPending = false, mime = "video/mp4")

    override fun openStream(assetId: Long): InputStream = ByteArrayInputStream(bytes)

    override fun hasFullReadAccess() = true
  }

  @Test
  fun `enospc mid-stream classifies not-enough-space and deletes the dest`() {
    val dest = File(tmp.root, "out.mp4")
    dest.writeBytes(ByteArray(4)) // pre-seed so the delete-on-failure is observable
    var written = 0
    val error = assertThrows(CodedError::class.java) {
      MediaAssetCopier.copy(
        source(ByteArray(300_000)), "42", dest.absolutePath, "c1", CopyRegistry(),
        chunkSize = 65536,
        writeOverride = { _, length ->
          written += length
          if (written > 100_000) throw IOException("No space left on device")
        })
    }
    assertEquals("not-enough-space", error.code)
    assertFalse(dest.exists())
  }

  @Test
  fun `cancel mid-copy classifies cancelled with no callbacks after and no partial`() {
    val dest = File(tmp.root, "out.mp4")
    dest.writeBytes(ByteArray(4)) // pre-seed so the delete-on-failure is observable
    val registry = CopyRegistry()
    registry.register("c2")
    var progressAfterCancel = 0
    var cancelled = false

    val error = assertThrows(CodedError::class.java) {
      MediaAssetCopier.copy(
        source(ByteArray(500_000)), "42", dest.absolutePath, "c2", registry,
        chunkSize = 65536,
        writeOverride = { _, _ ->
          if (!cancelled) {
            registry.cancel("c2")
            cancelled = true
          }
        },
        onProgress = { _, _ -> if (cancelled) progressAfterCancel += 1 })
    }
    assertEquals("cancelled", error.code)
    assertFalse(dest.exists())
    assertEquals(0, progressAfterCancel)
  }

  @Test
  fun `progress reports a null total when the asset size is unknown`() {
    val dest = File(tmp.root, "out.mp4")
    val totals = mutableListOf<Long?>()
    MediaAssetCopier.copy(
      source(ByteArray(200_000)), "42", dest.absolutePath, "c3", CopyRegistry(),
      chunkSize = 65536,
      onProgress = { _, total -> totals.add(total) })
    assertFalse(totals.isEmpty())
    assertTrue(totals.all { it == null })
  }
}
