import { useApp } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { useCallback } from 'react'
import { usePlatform } from '../context/platform'
import { navigate } from '../lib/router'
import { useFileSelectionStore } from '../stores/fileSelection'
import { useToastStore } from '../stores/toast'

export function useFileActions() {
  const app = useApp()
  const exitSelectionMode = useFileSelectionStore((s) => s.exitSelectionMode)
  const addToast = useToastStore((s) => s.addToast)
  const platform = usePlatform()

  const handleDownloadFile = useCallback(
    async (file: FileRecord) => {
      try {
        await app.downloads.downloadFile(file.id)
        const data = await app.downloads.readFile(file.id)
        platform.saveFileToDisk(data, file.name, file.type)
        addToast('Download started')
      } catch {
        addToast('Download failed', 'error')
      }
    },
    [app, addToast, platform],
  )

  const handleToggleFavorite = useCallback(
    async (file: FileRecord) => {
      await app.tags.toggleFavorite(file.id)
      addToast('Favorites updated')
    },
    [app, addToast],
  )

  const handleRename = useCallback(
    async (fileId: string, newName: string) => {
      await app.files.update({
        id: fileId,
        name: newName,
        updatedAt: Date.now(),
      })
      addToast('File renamed')
    },
    [app, addToast],
  )

  const handleDeleteFiles = useCallback(
    async (fileIds: string[]) => {
      await app.files.trash(fileIds)
      exitSelectionMode()
      addToast(
        fileIds.length === 1
          ? 'File moved to trash'
          : `${fileIds.length.toLocaleString()} files moved to trash`,
      )
    },
    [app, exitSelectionMode, addToast],
  )

  const handleDeleteConfirm = useCallback(
    async (
      deleteTarget: {
        type: string
        ids: string[]
        label: string
      } | null,
    ) => {
      if (!deleteTarget) return

      if (deleteTarget.type === 'file' || deleteTarget.type === 'files') {
        await handleDeleteFiles(deleteTarget.ids)
      } else if (deleteTarget.type === 'directory') {
        await app.directories.deleteAndTrashFiles(deleteTarget.ids[0])
        navigate('#/files')
        addToast(`Deleted folder "${deleteTarget.label}"`)
      } else if (deleteTarget.type === 'tag') {
        await app.tags.delete(deleteTarget.ids[0])
        navigate('#/tags')
        addToast(`Deleted tag "${deleteTarget.label}"`)
      }
    },
    [app, handleDeleteFiles, addToast],
  )

  return {
    handleDownloadFile,
    handleToggleFavorite,
    handleRename,
    handleDeleteFiles,
    handleDeleteConfirm,
  }
}
