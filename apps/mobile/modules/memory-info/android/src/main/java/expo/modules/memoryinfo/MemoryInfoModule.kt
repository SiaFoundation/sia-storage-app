package expo.modules.memoryinfo

import android.app.ActivityManager
import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Reports how much memory the system can spare, so transfers size their
// buffers against that rather than against the device's total RAM.
class MemoryInfoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MemoryInfo")

    Function("read") { MemoryReading.read(appContext.reactContext) }
  }
}

internal object MemoryReading {
  /**
   * `threshold` is the available-memory level at which Android starts
   * killing background processes, so only availMem above it can be spent.
   * `lowMemory` says the system is already there. Null when there is no
   * context to ask, which JS treats as no reading.
   */
  fun read(context: Context?): Map<String, Any>? {
    val activityManager =
      context?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return null
    val info = ActivityManager.MemoryInfo()
    activityManager.getMemoryInfo(info)
    return mapOf(
      "availableBytes" to info.availMem,
      "thresholdBytes" to info.threshold,
      "lowMemory" to info.lowMemory,
    )
  }
}
