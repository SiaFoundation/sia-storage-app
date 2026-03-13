import { useApp, useFileList, useLoadMore } from '@siastorage/core/stores'
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
import { InfiniteFileGrid } from '../library/InfiniteFileGrid'
import { ViewSettingsMenu } from '../library/ViewSettingsMenu'

const PAGE_SIZE = 50

export function MediaPage() {
  const svc = useApp()
  const settings = useViewSettings('library')

  const fileList = useFileList({
    scope: 'library',
    sortBy: settings.sortBy,
    sortDir: settings.sortDir,
    categories: settings.selectedCategories,
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

  const [page, setPage] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset
  useEffect(() => {
    setPage(0)
  }, [settings.sortBy, settings.sortDir, settings.selectedCategories])

  const totalPages = Math.ceil(allFiles.length / PAGE_SIZE)
  const pageFiles = useMemo(
    () => allFiles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [allFiles, page],
  )

  const fileIds = useMemo(() => {
    if (settings.viewMode === 'gallery') return allFiles.map((f) => f.id)
    return pageFiles.map((f) => f.id)
  }, [allFiles, pageFiles, settings.viewMode])

  const { thumbnailUrls, addLocalThumbnails: _ } = useThumbnails(fileIds)

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

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        navigate('#/search')
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        navigate('#/search')
      }
      if (e.key === 'Escape' && isSelectionMode) {
        exitSelectionMode()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && isSelectionMode) {
        e.preventDefault()
        selectAll(allFiles.map((f) => f.id))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isSelectionMode, exitSelectionMode, selectAll, allFiles])

  return (
    <>
      {isSelectionMode ? (
        <SelectionBar
          allFileIds={
            settings.viewMode === 'gallery'
              ? allFiles.map((f) => f.id)
              : pageFiles.map((f) => f.id)
          }
        />
      ) : (
        <ViewToolbar count={allFiles.length}>
          <ViewSettingsMenu scope="library" />
          <button
            type="button"
            onClick={enterSelectionMode}
            className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors"
          >
            Select
          </button>
        </ViewToolbar>
      )}
      <ContentLayout>
        {settings.viewMode === 'gallery' ? (
          <InfiniteFileGrid
            files={allFiles}
            loading={isLoading && allFiles.length === 0}
            hasMore={fileList.hasMore}
            onLoadMore={loadMore}
            thumbnailUrls={thumbnailUrls}
            isSelectionMode={isSelectionMode}
            selectedFileIds={selectedFileIds}
            onSelectFile={handleSelectFile}
            onToggleSelection={toggleFileSelection}
            onContextMenu={handleContextMenu}
          />
        ) : (
          <FileGrid
            files={pageFiles}
            loading={isLoading && allFiles.length === 0}
            viewMode="list"
            thumbnailUrls={thumbnailUrls}
            isSelectionMode={isSelectionMode}
            selectedFileIds={selectedFileIds}
            page={page}
            totalPages={totalPages}
            onSelectFile={handleSelectFile}
            onToggleSelection={toggleFileSelection}
            onContextMenu={handleContextMenu}
            onPageChange={setPage}
          />
        )}
      </ContentLayout>
    </>
  )
}
