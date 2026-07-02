package expo.modules.importsources

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

private class ReaderException(code: String, message: String) :
  CodedException(code, message, null)

/**
 * Expo module that copies MediaStore assets to app storage, hashing in the
 * same read and emitting throttled copyProgress events.
 */
class MediaAssetReaderModule : Module() {
  private val scope = CoroutineScope(Dispatchers.IO)

  private val resolver
    get() = requireNotNull(appContext.reactContext).contentResolver

  private fun hasFullReadAccess(): Boolean {
    val context = requireNotNull(appContext.reactContext)
    if (Build.VERSION.SDK_INT < 33) {
      return context.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) ==
        PackageManager.PERMISSION_GRANTED
    }
    return context.checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) ==
      PackageManager.PERMISSION_GRANTED ||
      context.checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) ==
        PackageManager.PERMISSION_GRANTED
  }

  override fun definition() = ModuleDefinition {
    Name("MediaAssetReader")

    Events("copyProgress")

    OnDestroy {
      // A JS reload orphans in-flight copies: cancel them so nothing streams
      // into (or sends events from) a dead context.
      scope.cancel()
    }

    AsyncFunction("copyAsset") { assetId: String, destPath: String, copyId: String, promise: Promise ->
      CopyRegistry.shared.register(copyId)
      scope.launch {
        val throttle = ProgressThrottle()
        try {
          val source = ContentResolverMediaSource(resolver) { hasFullReadAccess() }
          val result =
            MediaAssetCopier.copy(
              source,
              assetId,
              SourceRefCodec.pathFromFileUriOrPath(destPath),
              copyId,
              onProgress = { bytes, total ->
                if (throttle.shouldEmit(bytes, System.currentTimeMillis())) {
                  sendEvent(
                    "copyProgress",
                    mapOf(
                      "copyId" to copyId,
                      "bytesCopied" to bytes,
                      "totalBytes" to total,
                      "fraction" to total?.let { bytes.toDouble() / it },
                    ))
                }
              })
          val cancelled = CopyRegistry.shared.finish(copyId)
          if (cancelled) {
            promise.reject(ReaderException("cancelled", "copy cancelled"))
          } else {
            promise.resolve(
              mapOf(
                "size" to result.size,
                "sha256" to result.sha256Hex,
                "mime" to result.mime,
                "variant" to result.variant,
              ))
          }
        } catch (e: CodedError) {
          CopyRegistry.shared.finish(copyId)
          promise.reject(ReaderException(e.code, e.message ?: ""))
        } catch (e: Exception) {
          CopyRegistry.shared.finish(copyId)
          promise.reject(ReaderException("io-error", e.message ?: ""))
        }
      }
    }

    AsyncFunction("cancelCopy") { copyId: String ->
      CopyRegistry.shared.cancel(copyId)
    }

    AsyncFunction("getSizes") { assetIds: List<String>, promise: Promise ->
      scope.launch {
        try {
          promise.resolve(SizeQuery.query(resolver, assetIds))
        } catch (e: SecurityException) {
          promise.reject(ReaderException("permission-denied", e.message ?: ""))
        } catch (e: Exception) {
          promise.reject(ReaderException("io-error", e.message ?: ""))
        }
      }
    }
  }
}
