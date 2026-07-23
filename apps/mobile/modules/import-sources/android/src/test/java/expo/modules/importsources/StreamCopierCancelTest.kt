package expo.modules.importsources

import androidx.test.core.app.ApplicationProvider
import java.io.File
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
class StreamCopierCancelTest {
  @get:Rule val tmp = TemporaryFolder()

  private val resolver =
    ApplicationProvider.getApplicationContext<android.content.Context>().contentResolver

  @Test
  fun `cancellation mid-loop classifies cancelled and deletes the dest`() {
    val source = File(tmp.root, "src.bin").apply { writeBytes(ByteArray(500_000)) }
    val dest = File(tmp.root, "out.bin")
    val registry = CopyRegistry()
    registry.register("c1")

    var chunks = 0
    val error = assertThrows(CodedError::class.java) {
      StreamCopier.copy(
        resolver, source.absolutePath, dest.absolutePath, copyId = "c1", registry = registry,
        chunkSize = 65536,
        writeOverride = { _, _ ->
          chunks += 1
          if (chunks == 2) registry.cancel("c1")
        })
    }
    assertEquals("cancelled", error.code)
    assertFalse(dest.exists())
  }
}
