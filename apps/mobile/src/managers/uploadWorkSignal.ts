/**
 * Tells the Android upload service that upload work may have been added, such
 * as an import just staged. Imports are staged without a library change, so
 * the service would otherwise hear of them only at its next poll, by which
 * time the phone may be locked and Android refuses the start. A module of its
 * own so the import code reaching it loads nothing native.
 */
const listeners = new Set<() => void>()

export function noteUploadWork(): void {
  for (const listener of listeners) listener()
}

export function onUploadWork(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
