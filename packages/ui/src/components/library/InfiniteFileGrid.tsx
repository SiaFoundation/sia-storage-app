import type { FileRecord } from '@siastorage/core/types'
import { useEffect, useRef, useState } from 'react'
import { BlocksLoader } from '../ui/BlocksLoader'
import { EmptyState } from '../ui/EmptyState'
import { FileCard } from './FileCard'

const PAGE_SIZE = 50

type InfiniteFileGridProps = {
  files: FileRecord[]
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
  thumbnailUrls: Record<string, string>
  isSelectionMode: boolean
  selectedFileIds: string[]
  onSelectFile: (file: FileRecord) => void
  onToggleSelection: (id: string) => void
  onContextMenu: (e: React.MouseEvent, file: FileRecord) => void
}

export function InfiniteFileGrid({
  files,
  loading,
  hasMore,
  onLoadMore,
  thumbnailUrls,
  isSelectionMode,
  selectedFileIds,
  onSelectFile,
  onToggleSelection,
  onContextMenu,
}: InfiniteFileGridProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset when file count changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [files.length])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (visibleCount < files.length) {
            setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, files.length))
          }
          if (hasMore) {
            onLoadMore()
          }
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [visibleCount, files.length, hasMore, onLoadMore])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <BlocksLoader label="Loading files..." />
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <EmptyState
        title="Add files to get started"
        description="Upload files to start building your library."
      />
    )
  }

  const visibleFiles = files.slice(0, visibleCount)

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-1">
        {visibleFiles.map((file) => (
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
      {(visibleCount < files.length || hasMore) && (
        <div ref={sentinelRef} className="h-10" />
      )}
    </>
  )
}
