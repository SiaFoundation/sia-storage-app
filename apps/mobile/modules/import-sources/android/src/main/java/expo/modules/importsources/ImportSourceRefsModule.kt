package expo.modules.importsources

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.ext.SdkExtensions
import android.provider.MediaStore
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private class ImportSourcesException(code: String, message: String) :
  CodedException(code, message, null)

private fun <T> rethrowCoded(body: () -> T): T =
  try {
    body()
  } catch (e: CodedError) {
    throw ImportSourcesException(e.code, e.message ?: "")
  }

/**
 * Durable source refs on Android: the OS grant table holds the durability, we
 * store only the tagged uri. Every failure crosses the bridge with a coded
 * error. Both pickers return uris untouched, so a pick moves zero bytes:
 * `pickFiles` fires ACTION_OPEN_DOCUMENT (grant-backed originals) and
 * `pickMedia` the system Photo Picker; the scanner streams the uris
 * directly for the one and only copy.
 */
class ImportSourceRefsModule : Module() {
  private companion object {
    const val PICK_MEDIA_REQUEST = 0x51AF
    const val PICK_FILES_REQUEST = 0x51B0
  }

  private val resolver
    get() = requireNotNull(appContext.reactContext).contentResolver

  private val pendingPicks = mutableMapOf<Int, Promise>()

  private fun launchPick(requestCode: Int, intent: Intent, promise: Promise) {
    if (pendingPicks.containsKey(requestCode)) {
      throw ImportSourcesException("io-error", "a pick is already in progress")
    }
    val activity =
      appContext.currentActivity
        ?: throw ImportSourcesException("io-error", "no foreground activity")
    pendingPicks[requestCode] = promise
    activity.startActivityForResult(intent, requestCode)
  }

  // Runtime probe, not an SDK check alone: the picker ships to Android 11/12
  // via the R extension backport.
  private fun photoPickerAvailable(): Boolean =
    Build.VERSION.SDK_INT >= 33 ||
      (Build.VERSION.SDK_INT >= 30 &&
        SdkExtensions.getExtensionVersion(Build.VERSION_CODES.R) >= 2)

  private fun buildPickIntent(): Intent =
    if (photoPickerAvailable()) {
      Intent(MediaStore.ACTION_PICK_IMAGES).apply {
        // No type set: the picker offers both photos and videos.
        if (Build.VERSION.SDK_INT >= 33) {
          putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, MediaStore.getPickImagesMaxLimit())
        } else {
          // getPickImagesMaxLimit needs API 33; the backport documents 100.
          putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 100)
        }
      }
    } else {
      Intent(Intent.ACTION_GET_CONTENT).apply {
        type = "*/*"
        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        addCategory(Intent.CATEGORY_OPENABLE)
      }
    }

  private val grants by lazy {
    GrantManager(ContentResolverGrantStore(resolver), Build.VERSION.SDK_INT)
  }
  private val tree by lazy { DocumentsContractTreeSource(resolver) }

  override fun definition() = ModuleDefinition {
    Name("ImportSourceRefs")

    AsyncFunction("createFileBookmarks") { uris: List<String> ->
      uris.map { uri ->
        try {
          mapOf("ref" to grants.takeFileGrant(uri))
        } catch (e: CodedError) {
          mapOf("code" to e.code)
        }
      }
    }

    AsyncFunction("createDirBookmark") { uri: String ->
      rethrowCoded { grants.takeTreeGrant(uri) }
    }

    AsyncFunction("startAccess") { ref: String ->
      rethrowCoded {
        // Android grants don't go stale; revocation surfaces here as
        // permission-denied before any bytes move.
        mapOf("uri" to grants.assertHeld(ref), "stale" to false)
      }
    }

    AsyncFunction("startAccessChild") { dirRef: String, key: String ->
      rethrowCoded {
        val treeUri = grants.assertHeld(dirRef)
        val child =
          tree.childUri(treeUri, key) ?: throw CodedError("deleted", "child missing: $key")
        mapOf("uri" to child)
      }
    }

    AsyncFunction("stopAccess") { _: String -> }

    AsyncFunction("stopAccessDir") { _: String -> }

    AsyncFunction("enumerateDir") { dirRef: String ->
      rethrowCoded {
        val treeUri = grants.assertHeld(dirRef)
        tree.listChildren(treeUri).map {
          mapOf("name" to it.name, "key" to it.key, "size" to it.size, "type" to it.type)
        }
      }
    }

    AsyncFunction("copyToPath") { srcUri: String, destPath: String, copyId: String? ->
      rethrowCoded {
        if (copyId != null) CopyRegistry.shared.register(copyId)
        try {
          val result = StreamCopier.copy(resolver, srcUri, destPath, copyId)
          buildMap {
            put("size", result.size)
            put("sha256", result.sha256Hex)
            if (result.headBytes.isNotEmpty()) {
              put("headBytes", android.util.Base64.encodeToString(result.headBytes, android.util.Base64.NO_WRAP))
            }
          }
        } finally {
          if (copyId != null) CopyRegistry.shared.finish(copyId)
        }
      }
    }

    AsyncFunction("releaseGrant") { ref: String ->
      rethrowCoded { grants.release(ref) }
    }

    AsyncFunction("grantBudgetRemaining") {
      grants.budgetRemaining()
    }

    AsyncFunction("pickMedia") { promise: Promise ->
      launchPick(PICK_MEDIA_REQUEST, buildPickIntent(), promise)
    }

    AsyncFunction("pickFiles") { promise: Promise ->
      launchPick(
        PICK_FILES_REQUEST,
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "*/*"
          putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        },
        promise,
      )
    }

    OnActivityResult { _, payload ->
      val promise = pendingPicks.remove(payload.requestCode) ?: return@OnActivityResult
      val data = payload.data
      if (payload.resultCode != Activity.RESULT_OK || data == null) {
        // Dismissal resolves empty, matching the iOS pickers.
        promise.resolve(emptyList<Map<String, Any?>>())
        return@OnActivityResult
      }
      val uris = mutableListOf<Uri>()
      val clip = data.clipData
      if (clip != null) {
        for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
      } else {
        data.data?.let { uris.add(it) }
      }
      promise.resolve(uris.map { PickedMediaQuery.resolve(resolver, it) })
    }
  }
}
