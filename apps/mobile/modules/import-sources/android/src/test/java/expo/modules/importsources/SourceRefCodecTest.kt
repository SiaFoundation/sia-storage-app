package expo.modules.importsources

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SourceRefCodecTest {
  @Test
  fun `uri refs round-trip through the android-uri tag`() {
    val uri = "content://com.android.providers.media.documents/document/image%3A42"
    val ref = SourceRefCodec.encodeUri(uri)
    assertEquals("android-uri:$uri", ref)
    assertEquals(uri, SourceRefCodec.decodeUri(ref))
  }

  @Test
  fun `foreign tag maps to io-error`() {
    val error = assertThrows(CodedError::class.java) {
      SourceRefCodec.decodeUri("ios-bm:AAAA")
    }
    assertEquals("io-error", error.code)
  }

  @Test
  fun `file uris percent-decode and plain paths pass through`() {
    assertEquals("/a b/c#d", SourceRefCodec.pathFromFileUriOrPath("file:///a%20b/c%23d"))
    assertEquals("/plain/path", SourceRefCodec.pathFromFileUriOrPath("/plain/path"))
  }
}
