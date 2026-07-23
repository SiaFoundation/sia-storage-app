package expo.modules.importsources

/**
 * Process-wide cancellation registry shared by both module classes, giving
 * `copyToPath` and `copyAsset` one copyId namespace. Completion and cancel
 * race to exactly one outcome: a finished copy ignores a late cancel; a
 * cancelled copy never delivers a result.
 */
class CopyRegistry {
  companion object {
    val shared = CopyRegistry()
  }

  private data class Entry(var cancelled: Boolean = false, var onCancel: (() -> Unit)? = null)

  private val entries = HashMap<String, Entry>()

  @Synchronized
  fun register(copyId: String, onCancel: (() -> Unit)? = null) {
    entries[copyId] = Entry(onCancel = onCancel)
  }

  fun cancel(copyId: String) {
    val action: (() -> Unit)?
    synchronized(this) {
      val entry = entries[copyId] ?: return
      if (entry.cancelled) return
      entry.cancelled = true
      action = entry.onCancel
      entry.onCancel = null
    }
    action?.invoke()
  }

  @Synchronized
  fun isCancelled(copyId: String): Boolean = entries[copyId]?.cancelled ?: false

  /** Removes the entry; returns whether cancel won (suppress the result). */
  @Synchronized
  fun finish(copyId: String): Boolean {
    val wasCancelled = entries[copyId]?.cancelled ?: false
    entries.remove(copyId)
    return wasCancelled
  }
}
