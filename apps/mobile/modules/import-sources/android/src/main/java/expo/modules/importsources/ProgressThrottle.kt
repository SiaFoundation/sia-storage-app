package expo.modules.importsources

/**
 * Gates progress events: emit when at least 100ms elapsed or 1MB moved since
 * the last emission. The first update always passes; the final emission is
 * the caller's job because the throttle cannot know which update is last.
 */
class ProgressThrottle {
  companion object {
    const val MIN_INTERVAL_MS = 100L
    const val MIN_BYTES = 1_048_576L
  }

  private var lastBytes = -1L
  private var lastTimeMs = -1L

  fun shouldEmit(bytes: Long, nowMs: Long): Boolean {
    if (lastTimeMs < 0 || nowMs - lastTimeMs >= MIN_INTERVAL_MS || bytes - lastBytes >= MIN_BYTES) {
      lastBytes = bytes
      lastTimeMs = nowMs
      return true
    }
    return false
  }
}
