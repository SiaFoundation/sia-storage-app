package expo.modules.memoryinfo

import android.app.ActivityManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class MemoryReadingTest {
  private val context: Context = ApplicationProvider.getApplicationContext()

  @Test
  fun `reports what the system says is available, its kill level and whether it is short`() {
    val info =
      ActivityManager.MemoryInfo().apply {
        availMem = 1_200_000_000L
        threshold = 400_000_000L
        lowMemory = true
      }
    val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    shadowOf(activityManager).setMemoryInfo(info)

    val reading = MemoryReading.read(context)

    assertEquals(1_200_000_000L, reading?.get("availableBytes"))
    assertEquals(400_000_000L, reading?.get("thresholdBytes"))
    assertEquals(true, reading?.get("lowMemory"))
  }

  @Test
  fun `no context gives no reading rather than throwing`() {
    assertNull(MemoryReading.read(null))
  }
}
