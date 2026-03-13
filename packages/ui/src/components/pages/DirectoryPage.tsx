import {
  useAllDirectories,
  useApp,
  useFileList,
  useLoadMore,
} from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useThumbnails } from '../../hooks/useThumbnails'
import { navigate } from '../../lib/router'
import { useFileSelectionStore } from '../../stores/fileSelection'
import { useModalStore } from '../../stores/modal'
import { useViewSettings } from '../../stores/viewSettings'
import { ContentLayout } from '../layout/ContentLayout'
import { SelectionBar } from '../layout/SelectionBar'
import { ViewToolbar } from '../layout/ViewToolbar'
import { FileGrid } from '../library/FileGrid'
import { RenameModal } from '../library/RenameModal'
import { ViewSettingsMenu } from '../library/ViewSettingsMenu'
import { DropdownMenu } from '../ui/DropdownMenu'

const PAGE_SIZE = 50

export function DirectoryPage({ id }: { id: string }) {
  const svc = useApp()
  const { data: directoriesData } = useAllDirectories()
  const directories = directoriesData ?? []

  const viewScope = `dir.${id}`
  const settings = useViewSettings(viewScope)

  const fileList = useFileList({
    scope: `dir.${id}`,
    sortBy: settings.sortBy,
    sortDir: settings.sortDir,
    categories: settings.selectedCategories,
    directoryId: id,
  })
  const { data: files, isLoading } = fileList
  const { loadMore } = useLoadMore(fileList)

  const allFiles = files ?? []

  const isSelectionMode = useFileSelectionStore((s) => s.isSelectionMode)
  const selectedFileIds = useFileSelectionStore((s) => s.selectedFileIds)
  const enterSelectionMode = useFileSelectionStore((s) => s.enterSelectionMode)
  const exitSelectionMode = useFileSelectionStore((s) => s.exitSelectionMode)
  const toggleFileSelection = useFileSelectionStore(
    (s) => s.toggleFileSelection,
  )
  const selectAll = useFileSelectionStore((s) => s.selectAll)

  const openContextMenu = useModalStore((s) => s.openContextMenu)
  const openDelete = useModalStore((s) => s.openDelete)

  const [renameOpen, setRenameOpen] = useState(false)
  const [page, setPage] = useState(0)

  const dir = directories.find((d) => d.id === id)
  const dirName = dir?.name ?? 'Folder'

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset
  useEffect(() => {
    setPage(0)
  }, [id, settings.sortBy, settings.sortDir, settings.selectedCategories])

  useEffect(() => {
    const needed = (page + 1) * PAGE_SIZE
    if (needed > allFiles.length && fileList.hasMore) {
      loadMore()
    }
  }, [page, allFiles.length, fileList.hasMore, loadMore])

  const totalPages = Math.ceil(allFiles.length / PAGE_SIZE)
  const pageFiles = useMemo(
    () => allFiles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [allFiles, page],
  )

  const fileIds = useMemo(() => pageFiles.map((f) => f.id), [pageFiles])
  const { thumbnailUrls } = useThumbnails(fileIds)

  const handleSelectFile = useCallback((file: FileRecord) => {
    navigate(`#/file/${file.id}`)
  }, [])

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent, file: FileRecord) => {
      e.preventDefault()
      const tagNames = await svc.tags.getNamesForFile(file.id)
      openContextMenu(
        file.id,
        { x: e.clientX, y: e.clientY },
        (tagNames ?? []).includes('Favorites'),
      )
    },
    [svc, openContextMenu],
  )

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return
      if (e.key === 'Escape' && isSelectionMode) exitSelectionMode()
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && isSelectionMode) {
        e.preventDefault()
        selectAll(pageFiles.map((f) => f.id))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isSelectionMode, exitSelectionMode, selectAll, pageFiles])

  return (
    <>
      {isSelectionMode ? (
        <SelectionBar allFileIds={pageFiles.map((f) => f.id)} />
      ) : (
        <ViewToolbar
          breadcrumbs={[
            { label: 'Files', path: '#/files' },
            { label: dirName },
          ]}
          count={allFiles.length}
        >
          <ViewSettingsMenu scope={viewScope} />
          <button
            type="button"
            onClick={enterSelectionMode}
            className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors"
          >
            Select
          </button>
          <DropdownMenu
            items={[
              {
                label: 'Rename folder',
                onClick: () => setRenameOpen(true),
              },
              {
                label: 'Delete folder',
                destructive: true,
                onClick: () =>
                  openDelete({
                    type: 'directory',
                    ids: [id],
                    label: dirName,
                  }),
              },
            ]}
          />
        </ViewToolbar>
      )}
      <ContentLayout>
        <FileGrid
          files={pageFiles}
          loading={isLoading && allFiles.length === 0}
          viewMode={settings.viewMode}
          thumbnailUrls={thumbnailUrls}
          isSelectionMode={isSelectionMode}
          selectedFileIds={selectedFileIds}
          page={page}
          totalPages={totalPages}
          emptyTitle="No files in this folder"
          emptyDescription="Move files here or upload new ones."
          onSelectFile={handleSelectFile}
          onToggleSelection={toggleFileSelection}
          onContextMenu={handleContextMenu}
          onPageChange={setPage}
        />
      </ContentLayout>
      <RenameModal
        open={renameOpen}
        currentName={dirName}
        onClose={() => setRenameOpen(false)}
        onRename={(newName) => {
          svc.directories.rename(id, newName)
          setRenameOpen(false)
        }}
      />
    </>
  )
}
