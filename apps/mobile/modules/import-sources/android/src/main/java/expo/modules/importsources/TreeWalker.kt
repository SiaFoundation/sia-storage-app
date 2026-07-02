package expo.modules.importsources

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract

/**
 * SAF tree navigation behind an injectable interface. One tree grant covers
 * every child; children are addressed by documentId (`key`) built via
 * DocumentsContract, never by path concatenation.
 */
interface TreeSource {
  data class Child(val name: String, val key: String, val size: Long, val type: String)

  /** Snapshot of the tree's direct children. */
  fun listChildren(treeUri: String): List<Child>

  /** The child's content uri, or null when the provider has no such row. */
  fun childUri(treeUri: String, key: String): String?
}

class DocumentsContractTreeSource(private val resolver: ContentResolver) : TreeSource {
  override fun listChildren(treeUri: String): List<TreeSource.Child> {
    val tree = Uri.parse(treeUri)
    val childrenUri =
      DocumentsContract.buildChildDocumentsUriUsingTree(
        tree, DocumentsContract.getTreeDocumentId(tree))
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
    )
    val children = mutableListOf<TreeSource.Child>()
    resolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
      while (cursor.moveToNext()) {
        val mime = cursor.getString(3) ?: ""
        if (mime == DocumentsContract.Document.MIME_TYPE_DIR) continue
        children.add(
          TreeSource.Child(
            name = cursor.getString(0) ?: "",
            key = cursor.getString(1) ?: "",
            size = cursor.getLong(2),
            type = mime,
          ))
      }
    }
    return children
  }

  override fun childUri(treeUri: String, key: String): String? {
    val uri = DocumentsContract.buildDocumentUriUsingTree(Uri.parse(treeUri), key)
    // Existence probe: a provider with no such row returns an empty cursor.
    resolver.query(
      uri, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID), null, null, null)
      ?.use { cursor -> return if (cursor.moveToFirst()) uri.toString() else null }
    return null
  }
}
