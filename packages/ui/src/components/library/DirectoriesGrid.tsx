import { useAllDirectories } from '@siastorage/core/stores'
import { useMemo } from 'react'
import { useModalStore } from '../../stores/modal'
import type { SortDir, ViewMode } from '../../stores/viewSettings'
import { EmptyState } from '../ui/EmptyState'

type DirectoriesGridProps = {
  onSelectDirectory: (dirId: string) => void
  viewMode: ViewMode
  sortDir: SortDir
}

export function DirectoriesGrid({
  onSelectDirectory,
  viewMode,
  sortDir,
}: DirectoriesGridProps) {
  const { data: directoriesData } = useAllDirectories()
  const directories = directoriesData ?? []
  const loaded = directoriesData !== undefined
  const openCreateDirectory = useModalStore((s) => s.openCreateDirectory)

  const sorted = useMemo(() => {
    const copy = [...directories]
    copy.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name)
      return sortDir === 'ASC' ? cmp : -cmp
    })
    return copy
  }, [directories, sortDir])

  if (!loaded) return null

  if (directories.length === 0) {
    return (
      <EmptyState
        title="No folders yet"
        description="Create a folder to organize your files."
        action={{ label: 'Create Folder', onClick: openCreateDirectory }}
      />
    )
  }

  if (viewMode === 'list') {
    return (
      <div>
        <div className="flex items-center gap-3 px-3 h-8 border-b border-neutral-700/50 text-[11px] uppercase tracking-wider text-neutral-500 font-medium sticky top-[88px] bg-neutral-950 z-[5]">
          <span className="w-7 flex-shrink-0" />
          <span className="flex-1 min-w-0">Name</span>
          <span className="w-20 text-right flex-shrink-0">Files</span>
        </div>
        {sorted.map((dir) => (
          <button
            key={dir.id}
            type="button"
            onClick={() => onSelectDirectory(dir.id)}
            className="w-full flex items-center gap-3 px-3 h-11 hover:bg-white/[0.03] transition-colors text-left border-b border-neutral-800/50"
          >
            <FolderIcon className="w-7 h-7 flex-shrink-0" />
            <span className="text-sm text-neutral-200 truncate flex-1">
              {dir.name}
            </span>
            <span className="text-xs text-neutral-400 w-20 text-right flex-shrink-0 tabular-nums">
              {dir.fileCount.toLocaleString()}
            </span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {sorted.map((dir) => (
        <button
          key={dir.id}
          type="button"
          onClick={() => onSelectDirectory(dir.id)}
          className="group rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 text-center hover:bg-neutral-800/50 hover:border-neutral-700/50 transition-all"
        >
          <div className="flex justify-center mb-3">
            <FolderIcon className="w-16 h-16" />
          </div>
          <p className="text-sm font-medium text-neutral-200 truncate">
            {dir.name}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            {dir.fileCount.toLocaleString()} file
            {dir.fileCount !== 1 ? 's' : ''}
          </p>
        </button>
      ))}
    </div>
  )
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none">
      <title>Folder</title>
      <path
        d="M4 12a4 4 0 014-4h10l4 4h18a4 4 0 014 4v20a4 4 0 01-4 4H8a4 4 0 01-4-4V12z"
        fill="#1E3A5F"
      />
      <path
        d="M4 18a4 4 0 014-4h32a4 4 0 014 4v18a4 4 0 01-4 4H8a4 4 0 01-4-4V18z"
        fill="#3B82F6"
      />
    </svg>
  )
}
