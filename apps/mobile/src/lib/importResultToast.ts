import type { ImportFilesResult } from './processAssets'

type ToastLike = { show: (message: string) => void }

export function showImportResultToast(toast: ToastLike, result: ImportFilesResult): void {
  const n = result.newVersionCount
  // Silent on the happy path — the user already sees the new files.
  if (n <= 0) return
  if (n === 1) {
    toast.show('Added 1 file as a new version')
  } else {
    toast.show(`Added ${n.toLocaleString()} files as new versions`)
  }
}
