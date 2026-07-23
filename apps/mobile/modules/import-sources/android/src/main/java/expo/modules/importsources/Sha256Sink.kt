package expo.modules.importsources

import java.security.MessageDigest

/**
 * Streaming SHA-256 updated per copy chunk. Emits bare lowercase hex; only
 * the TS package index prefixes `sha256:`.
 */
class Sha256Sink {
  private val digest = MessageDigest.getInstance("SHA-256")

  fun update(bytes: ByteArray, length: Int = bytes.size) {
    digest.update(bytes, 0, length)
  }

  fun finalizeHex(): String = digest.digest().joinToString("") { "%02x".format(it) }
}
