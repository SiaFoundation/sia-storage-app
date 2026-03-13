import { useAllTags } from '@siastorage/core/stores'
import { useMemo } from 'react'
import { useModalStore } from '../../stores/modal'
import type { SortDir, ViewMode } from '../../stores/viewSettings'
import { EmptyState } from '../ui/EmptyState'

type TagsGridProps = {
  onSelectTag: (tagId: string) => void
  viewMode: ViewMode
  sortDir: SortDir
}

export function TagsGrid({ onSelectTag, viewMode, sortDir }: TagsGridProps) {
  const { data: tagsData } = useAllTags()
  const tags = tagsData ?? []
  const loaded = tagsData !== undefined
  const openCreateTag = useModalStore((s) => s.openCreateTag)

  const sorted = useMemo(() => {
    const copy = [...tags]
    copy.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name)
      return sortDir === 'ASC' ? cmp : -cmp
    })
    return copy
  }, [tags, sortDir])

  if (!loaded) return null

  if (tags.length === 0) {
    return (
      <EmptyState
        title="No tags yet"
        description="Create tags to categorize and find your files."
        action={{ label: 'Create Tag', onClick: openCreateTag }}
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
        {sorted.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => onSelectTag(tag.id)}
            className="w-full flex items-center gap-3 px-3 h-11 hover:bg-white/[0.03] transition-colors text-left border-b border-neutral-800/50"
          >
            <TagIcon className="w-7 h-7 flex-shrink-0" />
            <span className="text-sm text-neutral-200 truncate flex-1">
              {tag.name}
            </span>
            <span className="text-xs text-neutral-400 w-20 text-right flex-shrink-0 tabular-nums">
              {tag.fileCount.toLocaleString()}
            </span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {sorted.map((tag) => (
        <button
          key={tag.id}
          type="button"
          onClick={() => onSelectTag(tag.id)}
          className="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 text-center hover:bg-neutral-800/50 hover:border-neutral-700/50 transition-all"
        >
          <div className="flex justify-center mb-3">
            <TagIcon className="w-16 h-16" />
          </div>
          <p className="text-sm font-medium text-neutral-200 truncate">
            {tag.name}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            {tag.fileCount.toLocaleString()} file
            {tag.fileCount !== 1 ? 's' : ''}
          </p>
        </button>
      ))}
    </div>
  )
}

function TagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none">
      <title>Tag</title>
      <path
        d="M6 8a4 4 0 014-4h14.34a4 4 0 012.83 1.17l15.66 15.66a4 4 0 010 5.66L28.49 40.83a4 4 0 01-5.66 0L7.17 25.17A4 4 0 016 22.34V8z"
        fill="#8B5CF6"
      />
      <circle cx="16" cy="16" r="3" fill="#C4B5FD" />
    </svg>
  )
}
