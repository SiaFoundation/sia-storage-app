package expo.modules.importsources

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri

/**
 * Persistable-grant bookkeeping behind an injectable store so the semantics
 * test on the plain JVM. Android's durable state lives in the system grant
 * table (we store only the uri); the stored-grant cap is 512 on API 30+ and
 * 128 below.
 */
interface GrantStore {
  /** Throws SecurityException when the uri carries no persistable grant. */
  fun take(uri: String)

  /** Never throws; releasing an unknown or expired grant is a no-op. */
  fun release(uri: String)

  fun heldCount(): Int

  fun isHeld(uri: String): Boolean
}

class ContentResolverGrantStore(private val resolver: ContentResolver) : GrantStore {
  override fun take(uri: String) {
    resolver.takePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION)
  }

  override fun release(uri: String) {
    try {
      resolver.releasePersistableUriPermission(
        Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION)
    } catch (_: SecurityException) {
      // Already revoked or evicted, which is the desired end state.
    }
  }

  override fun heldCount(): Int = resolver.persistedUriPermissions.size

  override fun isHeld(uri: String): Boolean =
    resolver.persistedUriPermissions.any { it.uri.toString() == uri && it.isReadPermission }
}

class GrantManager(private val store: GrantStore, private val apiLevel: Int) {
  fun takeFileGrant(uri: String): String {
    try {
      store.take(uri)
    } catch (e: SecurityException) {
      throw CodedError("not-persistable", e.message ?: uri)
    }
    return SourceRefCodec.encodeUri(uri)
  }

  /** One grant covers the whole tree regardless of child count. */
  fun takeTreeGrant(uri: String): String = takeFileGrant(uri)

  fun assertHeld(ref: String): String {
    val uri = SourceRefCodec.decodeUri(ref)
    if (!store.isHeld(uri)) {
      throw CodedError("permission-denied", "grant revoked or evicted: $uri")
    }
    return uri
  }

  fun release(ref: String) {
    store.release(SourceRefCodec.decodeUri(ref))
  }

  fun budgetRemaining(): Int {
    val cap = if (apiLevel >= 30) 512 else 128
    return cap - store.heldCount()
  }
}
