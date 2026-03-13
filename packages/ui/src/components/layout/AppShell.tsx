import { useApp, useFileDetails } from '@siastorage/core/stores'
import { useCallback } from 'react'
import { usePlatform } from '../../context/platform'
import { useFileActions } from '../../hooks/useFileActions'
import { useFileSelectionStore } from '../../stores/fileSelection'
import { useModalStore } from '../../stores/modal'
import { CreateDirectoryDialog } from '../library/CreateDirectoryDialog'
import { CreateTagDialog } from '../library/CreateTagDialog'
import { FileActionsMenu } from '../library/FileActionsMenu'
import { ManageTagsModal } from '../library/ManageTagsModal'
import { MoveToDirectoryModal } from '../library/MoveToDirectoryModal'
import { RecordingModal } from '../library/RecordingModal'
import { RenameModal } from '../library/RenameModal'
import { StatusModal } from '../library/StatusModal'
import { UploadZone } from '../library/UploadZone'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { GlobalNav } from './GlobalNav'

type AppShellProps = {
  children: React.ReactNode
  onLocalThumbnails?: (urls: Record<string, string>) => void
  showLogo?: boolean
}

export function AppShell({
  children,
  onLocalThumbnails,
  showLogo,
}: AppShellProps) {
  const app = useApp()
  const manageTagsFileId = useModalStore((s) => s.manageTagsFileId)
  const closeManageTags = useModalStore((s) => s.closeManageTags)
  const moveToDirectoryFileIds = useModalStore((s) => s.moveToDirectoryFileIds)
  const closeMoveToDirectory = useModalStore((s) => s.closeMoveToDirectory)
  const renameFile = useModalStore((s) => s.renameFile)
  const closeRename = useModalStore((s) => s.closeRename)
  const deleteTarget = useModalStore((s) => s.deleteTarget)
  const closeDelete = useModalStore((s) => s.closeDelete)
  const statusOpen = useModalStore((s) => s.statusOpen)
  const closeStatus = useModalStore((s) => s.closeStatus)
  const recording = useModalStore((s) => s.recording)
  const closeRecording = useModalStore((s) => s.closeRecording)
  const contextMenu = useModalStore((s) => s.contextMenu)
  const closeContextMenu = useModalStore((s) => s.closeContextMenu)
  const openManageTags = useModalStore((s) => s.openManageTags)
  const openMoveToDirectory = useModalStore((s) => s.openMoveToDirectory)
  const openRename = useModalStore((s) => s.openRename)
  const openDelete = useModalStore((s) => s.openDelete)

  const exitSelectionMode = useFileSelectionStore((s) => s.exitSelectionMode)

  const contextFileId = contextMenu?.fileId ?? ''
  const { data: contextFile } = useFileDetails(contextFileId)

  const {
    handleDownloadFile,
    handleToggleFavorite,
    handleRename,
    handleDeleteConfirm,
  } = useFileActions()

  const handleDeleteConfirmAction = useCallback(async () => {
    await handleDeleteConfirm(deleteTarget)
    closeDelete()
  }, [deleteTarget, handleDeleteConfirm, closeDelete])

  const platform = usePlatform()

  const handleRecordingSave = useCallback(
    (blob: Blob, name: string) => {
      const file = new File([blob], name, { type: blob.type })
      platform.uploadFiles([file]).then((localUrls) => {
        if (onLocalThumbnails && Object.keys(localUrls).length > 0) {
          onLocalThumbnails(localUrls)
        }
      })
      closeRecording()
    },
    [onLocalThumbnails, closeRecording, platform],
  )

  return (
    <UploadZone onLocalThumbnails={onLocalThumbnails}>
      <div className="min-h-screen">
        <GlobalNav onLocalThumbnails={onLocalThumbnails} showLogo={showLogo} />
        {children}
      </div>

      {contextMenu && contextFile && (
        <FileActionsMenu
          position={contextMenu.position}
          isFavorite={contextMenu.isFavorite}
          onClose={closeContextMenu}
          onDownload={() => handleDownloadFile(contextFile)}
          onToggleFavorite={() => handleToggleFavorite(contextFile)}
          onManageTags={() => openManageTags(contextFile.id)}
          onMoveToDirectory={() => openMoveToDirectory([contextFile.id])}
          onRename={() => openRename(contextFile.id, contextFile.name)}
          onDelete={() =>
            openDelete({
              type: 'file',
              ids: [contextFile.id],
              label: contextFile.name,
            })
          }
        />
      )}

      <ManageTagsModal
        open={manageTagsFileId !== null}
        fileId={manageTagsFileId ?? ''}
        onClose={() => {
          closeManageTags()
          app.caches.libraryVersion.invalidate()
        }}
      />

      <MoveToDirectoryModal
        open={moveToDirectoryFileIds !== null}
        fileIds={moveToDirectoryFileIds ?? []}
        onClose={closeMoveToDirectory}
        onMoved={() => {
          app.caches.libraryVersion.invalidate()
          exitSelectionMode()
        }}
      />

      <RenameModal
        open={renameFile !== null}
        currentName={renameFile?.name ?? ''}
        onClose={closeRename}
        onRename={(newName) => {
          if (renameFile) handleRename(renameFile.id, newName)
          closeRename()
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete ${deleteTarget?.type === 'files' ? deleteTarget.label : deleteTarget?.type === 'directory' ? 'Folder' : deleteTarget?.type === 'tag' ? 'Tag' : 'File'}`}
        message={
          deleteTarget?.type === 'files'
            ? `Delete ${deleteTarget.label}? This cannot be undone.`
            : deleteTarget?.type === 'directory'
              ? `Delete folder "${deleteTarget.label}"? All files in this folder will be moved to trash.`
              : deleteTarget?.type === 'tag'
                ? `Delete tag "${deleteTarget.label}"? Files will keep their content.`
                : `Delete "${deleteTarget?.label}"? This cannot be undone.`
        }
        confirmLabel="Delete"
        destructive
        onConfirm={handleDeleteConfirmAction}
        onCancel={closeDelete}
      />

      <StatusModal open={statusOpen} onClose={closeStatus} />

      <CreateDirectoryDialog />
      <CreateTagDialog />

      {recording && (
        <RecordingModal
          type={recording}
          onSave={handleRecordingSave}
          onCancel={closeRecording}
        />
      )}
    </UploadZone>
  )
}
