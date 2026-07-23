package expo.modules.importsources

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

private class FakeGrantStore(
  private val rejectTake: Boolean = false,
) : GrantStore {
  val held = mutableSetOf<String>()

  override fun take(uri: String) {
    if (rejectTake) throw SecurityException("no persistable grant offered")
    held.add(uri)
  }

  override fun release(uri: String) {
    held.remove(uri)
  }

  override fun heldCount(): Int = held.size

  override fun isHeld(uri: String): Boolean = uri in held
}

class GrantManagerTest {
  @Test
  fun `taking a file grant returns a tagged android-uri ref`() {
    val manager = GrantManager(FakeGrantStore(), apiLevel = 33)
    val ref = manager.takeFileGrant("content://provider/doc/1")
    assertEquals("android-uri:content://provider/doc/1", ref)
  }

  @Test
  fun `budget splits by api level and recovers on release`() {
    val store = FakeGrantStore()
    val old = GrantManager(store, apiLevel = 29)
    val modern = GrantManager(store, apiLevel = 33)
    assertEquals(128, old.budgetRemaining())
    assertEquals(512, modern.budgetRemaining())

    val ref = modern.takeFileGrant("content://provider/doc/1")
    assertEquals(511, modern.budgetRemaining())
    modern.release(ref)
    assertEquals(512, modern.budgetRemaining())
  }

  @Test
  fun `a revoked grant classifies permission-denied at assertHeld`() {
    val store = FakeGrantStore()
    val manager = GrantManager(store, apiLevel = 33)
    val ref = manager.takeFileGrant("content://provider/doc/1")
    store.held.clear() // the OS evicted / the user revoked

    val error = assertThrows(CodedError::class.java) { manager.assertHeld(ref) }
    assertEquals("permission-denied", error.code)
  }

  @Test
  fun `a non-persistable uri classifies not-persistable when the grant is taken`() {
    val manager = GrantManager(FakeGrantStore(rejectTake = true), apiLevel = 33)
    val error = assertThrows(CodedError::class.java) {
      manager.takeFileGrant("content://provider/doc/1")
    }
    assertEquals("not-persistable", error.code)
  }

  @Test
  fun `releasing an unknown ref never throws`() {
    GrantManager(FakeGrantStore(), apiLevel = 33).release("android-uri:content://gone")
  }

  @Test
  fun `one tree grant covers a whole folder`() {
    val store = FakeGrantStore()
    val manager = GrantManager(store, apiLevel = 33)
    manager.takeTreeGrant("content://provider/tree/root")
    assertEquals(1, store.heldCount())
  }
}
