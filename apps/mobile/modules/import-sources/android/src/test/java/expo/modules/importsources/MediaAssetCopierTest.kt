package expo.modules.importsources

import android.provider.MediaStore
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private class FakeMediaSource(
  var row: MediaSource.Row? = MediaSource.Row(sizeBytes = null, isPending = false, mime = "image/jpeg"),
  var fullAccess: Boolean = true,
  var bytes: ByteArray = ByteArray(0),
) : MediaSource {
  override fun queryRow(assetId: Long): MediaSource.Row? = row

  override fun openStream(assetId: Long): InputStream = ByteArrayInputStream(bytes)

  override fun hasFullReadAccess(): Boolean = fullAccess
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class MediaAssetCopierTest {
  @get:Rule val tmp = TemporaryFolder()

  @Test
  fun `a readable row streams to dest and hashes the streamed bytes`() {
    val payload = ByteArray(90_000) { (it % 199).toByte() }
    val source = FakeMediaSource(bytes = payload)
    val dest = File(tmp.root, "out.jpg")

    val result = MediaAssetCopier.copy(source, "42", dest.absolutePath, "c1", CopyRegistry())

    assertEquals(payload.size.toLong(), result.size)
    assertEquals("image/jpeg", result.mime)
    assertEquals("original", result.variant)
    val expectedSha256 = Sha256Sink().also { it.update(payload) }.finalizeHex()
    assertEquals(expectedSha256, result.sha256Hex)
  }

  @Test
  fun `a missing row under full access classifies deleted`() {
    val source = FakeMediaSource(row = null, fullAccess = true)
    val error = assertThrows(CodedError::class.java) {
      MediaAssetCopier.copy(source, "42", File(tmp.root, "x").absolutePath, "c2", CopyRegistry())
    }
    assertEquals("deleted", error.code)
  }

  @Test
  fun `a missing row under selected-photos partial access classifies permission-denied`() {
    val source = FakeMediaSource(row = null, fullAccess = false)
    val error = assertThrows(CodedError::class.java) {
      MediaAssetCopier.copy(source, "42", File(tmp.root, "x").absolutePath, "c3", CopyRegistry())
    }
    assertEquals("permission-denied", error.code)
  }

  @Test
  fun `a pending row classifies source-pending`() {
    val source =
      FakeMediaSource(row = MediaSource.Row(sizeBytes = 10, isPending = true, mime = null))
    val error = assertThrows(CodedError::class.java) {
      MediaAssetCopier.copy(source, "42", File(tmp.root, "x").absolutePath, "c4", CopyRegistry())
    }
    assertEquals("source-pending", error.code)
  }

  @Test
  fun `a non-numeric asset id classifies deleted`() {
    val error = assertThrows(CodedError::class.java) {
      MediaAssetCopier.copy(
        FakeMediaSource(), "ph://ios-id", File(tmp.root, "x").absolutePath, "c5", CopyRegistry())
    }
    assertEquals("deleted", error.code)
  }

  @Test
  fun `the real projection never contains the deprecated DATA column`() {
    assertFalse(ContentResolverMediaSource.PROJECTION.contains(MediaStore.MediaColumns.DATA))
  }
}
