package expo.modules.importsources

import android.os.Build
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
 * error. There is no `pickFiles` here because expo's Android picker already
 * returns originals via ACTION_OPEN_DOCUMENT.
 */
class ImportSourceRefsModule : Module() {
  private val resolver
    get() = requireNotNull(appContext.reactContext).contentResolver

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
            result.mime?.let { put("mime", it) }
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
  }
}
