package expo.modules.importsources

/**
 * Magic-bytes mime detection over a copy's first chunk. Used only by
 * `copyToPath`, and only when the provider reports nothing better than
 * `application/octet-stream` (a SAF document with no extension); `copyAsset`
 * never sniffs because MediaStore carries the authoritative type. The table
 * mirrors the iOS MimeSniffer.
 */
object MimeSniffer {
  fun sniff(data: ByteArray): String? {
    val length = data.size
    if (length >= 3 && data[0] == 0xFF.b && data[1] == 0xD8.b && data[2] == 0xFF.b) {
      return "image/jpeg"
    }
    if (length >= 4 && data[0] == 0x89.b && data[1] == 0x50.b && data[2] == 0x4E.b && data[3] == 0x47.b) {
      return "image/png"
    }
    if (length >= 3 && data[0] == 0x47.b && data[1] == 0x49.b && data[2] == 0x46.b) {
      return "image/gif"
    }
    if (length >= 4 && data[0] == 0x25.b && data[1] == 0x50.b && data[2] == 0x44.b && data[3] == 0x46.b) {
      return "application/pdf"
    }
    if (length >= 4 && data[0] == 0x50.b && data[1] == 0x4B.b && data[2] == 0x03.b && data[3] == 0x04.b) {
      return "application/zip"
    }
    // ISO base-media formats: bytes 4-7 are "ftyp", brand at 8-11.
    if (length >= 12 && String(data, 4, 4, Charsets.US_ASCII) == "ftyp") {
      val brand = String(data, 8, 4, Charsets.US_ASCII)
      if (brand in setOf("heic", "heix", "hevc", "mif1", "msf1")) return "image/heic"
      if (brand.startsWith("qt")) return "video/quicktime"
      if (brand in setOf("mp41", "mp42", "isom", "iso2", "avc1", "mmp4")) return "video/mp4"
    }
    return null
  }

  private val Int.b: Byte get() = toByte()
}
