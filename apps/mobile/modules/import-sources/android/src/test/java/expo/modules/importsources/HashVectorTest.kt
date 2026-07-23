package expo.modules.importsources

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class HashVectorTest {
  @Test
  fun `matches the NIST abc vector`() {
    val sink = Sha256Sink()
    sink.update("abc".toByteArray())
    assertEquals(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", sink.finalizeHex())
  }

  @Test
  fun `chunk boundaries do not change the digest and hex is bare lowercase`() {
    val payload = ByteArray(200_000) { (it % 251).toByte() }
    val whole = Sha256Sink().also { it.update(payload) }.finalizeHex()

    for (chunkSize in intArrayOf(1, 7, 65536)) {
      val sink = Sha256Sink()
      var offset = 0
      while (offset < payload.size) {
        val length = minOf(chunkSize, payload.size - offset)
        sink.update(payload.copyOfRange(offset, offset + length))
        offset += length
      }
      assertEquals("chunk size $chunkSize", whole, sink.finalizeHex())
    }
    assertFalse(whole.startsWith("sha256:"))
    assertEquals(whole, whole.lowercase())
    assertEquals(64, whole.length)
  }
}
