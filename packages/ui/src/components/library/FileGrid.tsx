import type { FileRecord } from '@siastorage/core/types'
import { BlocksLoader } from '../ui/BlocksLoader'
import { EmptyState } from '../ui/EmptyState'
import { FileCard } from './FileCard'
import { FileListItem } from './FileListItem'

type FileGridProps = {
  files: FileRecord[]
  loading: boolean
  viewMode: 'gallery' | 'list'
  thumbnailUrls: Record<string, string>
  isSelectionMode: boolean
  selectedFileIds: string[]
  page: number
  totalPages: number
  stickyHeaderTop?: string
  emptyTitle?: string
  emptyDescription?: string
  onSelectFile: (file: FileRecord) => void
  onToggleSelection: (id: string) => void
  onContextMenu: (e: React.MouseEvent, file: FileRecord) => void
  onPageChange: (page: number) => void
}

export function FileGrid({
  files,
  loading,
  viewMode,
  thumbnailUrls,
  isSelectionMode,
  selectedFileIds,
  page,
  totalPages,
  stickyHeaderTop = 'top-[88px]',
  emptyTitle = 'No files found',
  emptyDescription,
  onSelectFile,
  onToggleSelection,
  onContextMenu,
  onPageChange,
}: FileGridProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <BlocksLoader label="Loading files..." />
      </div>
    )
  }

  if (files.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <>
      {viewMode === 'list' ? (
        <div>
          <div
            className={`flex items-center gap-3 px-3 h-8 border-b border-neutral-700/50 text-[11px] uppercase tracking-wider text-neutral-500 font-medium sticky ${stickyHeaderTop} bg-neutral-950 z-[5]`}
          >
            {isSelectionMode && <span className="w-4 flex-shrink-0" />}
            <span className="w-9 flex-shrink-0" />
            <span className="flex-1 min-w-0">Name</span>
            <span className="w-28 text-right flex-shrink-0 hidden sm:block">
              Type
            </span>
            <span className="w-20 text-right flex-shrink-0">Size</span>
            <span className="w-28 text-right flex-shrink-0 hidden md:block">
              Date
            </span>
          </div>
          {files.map((file) => (
            <FileListItem
              key={file.id}
              file={file}
              thumbnailUrl={thumbnailUrls[file.id]}
              selected={selectedFileIds.includes(file.id)}
              selectionMode={isSelectionMode}
              onClick={() => onSelectFile(file)}
              onSelect={() => onToggleSelection(file.id)}
              onContextMenu={(e) => onContextMenu(e, file)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-1">
          {files.map((file) => (
            <FileCard
              key={file.id}
              file={file}
              thumbnailUrl={thumbnailUrls[file.id]}
              selected={selectedFileIds.includes(file.id)}
              selectionMode={isSelectionMode}
              onClick={() => onSelectFile(file)}
              onSelect={() => onToggleSelection(file.id)}
              onContextMenu={(e) => onContextMenu(e, file)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-8">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-sm text-neutral-400 px-3">
            Page {(page + 1).toLocaleString()} of {totalPages.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </>
  )
}
