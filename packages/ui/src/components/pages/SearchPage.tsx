import { transformRow } from '@siastorage/core/db/operations'
import { useAllTags, useApp } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useThumbnails } from '../../hooks/useThumbnails'
import { navigate } from '../../lib/router'
import { useFileSelectionStore } from '../../stores/fileSelection'
import { useModalStore } from '../../stores/modal'
import { useViewSettings } from '../../stores/viewSettings'
import { ContentLayout } from '../layout/ContentLayout'
import { SelectionBar } from '../layout/SelectionBar'
import { FileGrid } from '../library/FileGrid'
import { ViewSettingsMenu } from '../library/ViewSettingsMenu'
import { BlocksLoader } from '../ui/BlocksLoader'
import { EmptyState } from '../ui/EmptyState'

export function SearchPage({ initialQuery }: { initialQuery: string }) {
  const svc = useApp()
  const [query, setQuery] = useState(initialQuery)
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery)
  const [tagFilters, setTagFilters] = useState<{ id: string; name: string }[]>(
    [],
  )
  const [results, setResults] = useState<FileRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { data: tagsData } = useAllTags()
  const tags = tagsData ?? []
  const settings = useViewSettings('search')

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
  const PAGE_SIZE = 50

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!debouncedQuery.trim() && tagFilters.length === 0) {
      setResults([])
      return
    }

    let cancelled = false
    setLoading(true)

    async function search() {
      const rows = await svc.files.queryLibrary({
        query: debouncedQuery.trim() || undefined,
        tags: tagFilters.length > 0 ? tagFilters.map((t) => t.id) : undefined,
        sortBy: settings.sortBy,
        sortDir: settings.sortDir,
        limit: 500,
      })
      if (!cancelled) {
        setResults(rows.map((r) => transformRow(r)))
        setLoading(false)
        setPage(0)
      }
    }

    search()
    return () => {
      cancelled = true
    }
  }, [svc, debouncedQuery, tagFilters, settings.sortBy, settings.sortDir])

  const totalPages = Math.ceil(results.length / PAGE_SIZE)
  const pageFiles = useMemo(
    () => results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [results, page],
  )

  const fileIds = useMemo(() => pageFiles.map((f) => f.id), [pageFiles])
  const { thumbnailUrls } = useThumbnails(fileIds)

  const tagSuggestions = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    const activeIds = new Set(tagFilters.map((t) => t.id))
    return tags
      .filter((t) => t.name.toLowerCase().includes(q) && !activeIds.has(t.id))
      .slice(0, 5)
  }, [query, tags, tagFilters])

  const showDropdown = inputFocused && tagSuggestions.length > 0

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
      if (e.key === 'Escape') {
        if (isSelectionMode) {
          exitSelectionMode()
          return
        }
        if (window.history.length > 1) {
          window.history.back()
        } else {
          navigate('#/')
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && isSelectionMode) {
        e.preventDefault()
        selectAll(pageFiles.map((f) => f.id))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isSelectionMode, exitSelectionMode, selectAll, pageFiles])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setInputFocused(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const hasQuery = debouncedQuery.trim() || tagFilters.length > 0

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      {isSelectionMode ? (
        <SelectionBar allFileIds={pageFiles.map((f) => f.id)} />
      ) : (
        <div className="sticky top-12 z-10 bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-800">
          <div className="max-w-7xl mx-auto px-6 h-10 flex items-center gap-3">
            <div className="relative flex-1 min-w-0" ref={dropdownRef}>
              <div className="flex items-center gap-1.5">
                {tagFilters.map((tf) => (
                  <button
                    key={tf.id}
                    type="button"
                    onClick={() =>
                      setTagFilters((prev) =>
                        prev.filter((t) => t.id !== tf.id),
                      )
                    }
                    className="px-2 py-0.5 text-xs bg-green-600/20 text-green-300 border border-green-600/30 rounded-full flex items-center gap-1 hover:bg-green-600/30 transition-colors shrink-0"
                  >
                    {tf.name}
                    <svg
                      className="w-3 h-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <title>Remove</title>
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                ))}
                <div className="relative flex-1 min-w-[120px]">
                  <svg
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <title>Search</title>
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setInputFocused(true)}
                    placeholder="Search files..."
                    className="w-full pl-7 pr-7 py-1 text-sm bg-transparent text-white placeholder-neutral-500 outline-none"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 transition-colors"
                      title="Clear"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <title>Clear</title>
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {showDropdown && (
                <div className="absolute left-0 top-full mt-1 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 z-20 min-w-[200px]">
                  {tagSuggestions.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setTagFilters((prev) => [
                          ...prev,
                          { id: tag.id, name: tag.name },
                        ])
                        setQuery('')
                      }}
                      className="w-full px-3 py-2 text-sm text-left text-neutral-300 hover:bg-neutral-700 transition-colors flex items-center gap-2"
                    >
                      <svg
                        className="w-3.5 h-3.5 text-neutral-500"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <title>Tag</title>
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                        <line x1="7" y1="7" x2="7.01" y2="7" />
                      </svg>
                      {tag.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {hasQuery && (
              <span className="text-xs text-neutral-500 shrink-0">
                {results.length.toLocaleString()} result
                {results.length !== 1 ? 's' : ''}
              </span>
            )}

            <ViewSettingsMenu scope="search" />
            <button
              type="button"
              onClick={enterSelectionMode}
              className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors shrink-0"
            >
              Select
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <ContentLayout maxWidth="max-w-4xl">
          {loading ? (
            <div className="flex justify-center py-12">
              <BlocksLoader label="Searching..." />
            </div>
          ) : results.length === 0 ? (
            hasQuery ? (
              <EmptyState
                title="No results found"
                description="No files matching your search or filters."
              />
            ) : (
              <EmptyState
                title="Search your files"
                description="Type to search by name or filter by tags."
              />
            )
          ) : (
            <FileGrid
              files={pageFiles}
              loading={false}
              viewMode={settings.viewMode}
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
      </div>
    </div>
  )
}
