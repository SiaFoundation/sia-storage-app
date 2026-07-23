package expo.modules.importsources

import android.system.ErrnoException
import android.system.OsConstants

/**
 * Error carrying a stable code string. The Expo module bindings map it to a
 * CodedException so JS reads `error.code`.
 */
class CodedError(val code: String, message: String = "") : Exception(message)

/** Classifies a copy/stream throw to a stable reason code. */
internal fun mapIoError(e: Exception): CodedError {
  if (e is CodedError) return e
  val errno = (e.cause as? ErrnoException) ?: (e as? ErrnoException)
  if (errno?.errno == OsConstants.ENOSPC || e.message?.contains("No space left") == true) {
    return CodedError("not-enough-space", e.message ?: "")
  }
  if (e is SecurityException) return CodedError("permission-denied", e.message ?: "")
  return CodedError("io-error", e.message ?: "")
}
