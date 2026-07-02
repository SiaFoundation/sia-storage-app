package expo.modules.importsources

import java.net.URLDecoder

/**
 * `android-uri:<uri>` ref tagging plus file:// percent-decoding. Pickers hand
 * over percent-encoded file URLs and every filesystem touch must use the
 * decoded path.
 */
object SourceRefCodec {
  const val URI_TAG = "android-uri:"

  fun encodeUri(uri: String): String = URI_TAG + uri

  fun decodeUri(ref: String): String {
    if (!ref.startsWith(URI_TAG)) {
      throw CodedError("io-error", "not an android-uri ref: $ref")
    }
    return ref.removePrefix(URI_TAG)
  }

  /** Decoded filesystem path for a file:// uri; plain paths pass through. */
  fun pathFromFileUriOrPath(value: String): String {
    if (!value.startsWith("file://")) return value
    return URLDecoder.decode(value.removePrefix("file://"), "UTF-8")
  }
}
