import { useAllDirectories, useApp } from '@siastorage/core/stores'
import { useEffect, useMemo, useState } from 'react'
import { useToastStore } from '../../stores/toast'
import { Dialog, DialogHeader } from '../ui/Dialog'

type MoveToDirectoryModalProps = {
  open: boolean
  fileIds: string[]
  currentDirectoryName?: string
  onClose: () => void
  onMoved: () => void
}

export function MoveToDirectoryModal({
  open,
  fileIds,
  currentDirectoryName,
  onClose,
  onMoved,
}: MoveToDirectoryModalProps) {
  const app = useApp()
  const { data: directoriesData } = useAllDirectories()
  const directories = directoriesData ?? []
  const addToast = useToastStore((s) => s.addToast)
  const [search, setSearch] = useState('')

  const filteredDirs = useMemo(() => {
    if (!search.trim()) return directories
    const q = search.toLowerCase()
    return directories.filter((d) => d.name.toLowerCase().includes(q))
  }, [directories, search])

  const exactMatch = directories.some(
    (d) => d.name.toLowerCase() === search.trim().toLowerCase(),
  )

  async function handleSelect(dirName: string | undefined, dirId?: string) {
    const resolvedDirId =
      dirId ??
      (dirName
        ? (directories.find((d) => d.name === dirName)?.id ?? null)
        : null)
    for (const fileId of fileIds) {
      await app.directories.moveFile(fileId, resolvedDirId)
    }
    const label = dirName ?? 'No folder'
    addToast(
      fileIds.length === 1
        ? `Moved to "${label}"`
        : `Moved ${fileIds.length.toLocaleString()} files to "${label}"`,
    )
    onMoved()
    onClose()
  }

  async function handleCreate() {
    const name = search.trim()
    if (!name) return
    try {
      const dir = await app.directories.create(name)
      await handleSelect(name, dir.id)
    } catch (e) {
      addToast(
        e instanceof Error ? e.message : 'Failed to create folder',
        'error',
      )
    }
  }

  useEffect(() => {
    if (!open) return
    setSearch('')
  }, [open])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="max-w-md"
      className="max-h-[80vh] flex flex-col"
    >
      <DialogHeader title="Move to Folder" onClose={onClose} />

      {currentDirectoryName && (
        <div className="px-4 py-2.5 border-b border-neutral-800/80 flex items-center gap-2">
          <span className="text-xs text-neutral-500">Current:</span>
          <span className="flex items-center gap-1.5 text-[13px] text-neutral-300">
            <svg
              className="w-3.5 h-3.5 text-neutral-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <title>Folder</title>
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            {currentDirectoryName}
          </span>
        </div>
      )}

      <div className="px-4 py-3 border-b border-neutral-800/80">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search or create folder..."
          className="w-full px-2.5 py-1.5 text-[13px] bg-neutral-800/80 border border-neutral-700/50 rounded-md text-white placeholder-neutral-500 outline-none focus:border-neutral-600 transition-colors"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        <button
          type="button"
          onClick={() => handleSelect(undefined)}
          className="w-full px-4 py-2 text-[13px] text-left text-neutral-400 hover:bg-neutral-800/60 transition-colors flex items-center gap-2"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <title>No folder</title>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          No folder
        </button>

        {search.trim() && !exactMatch && (
          <button
            type="button"
            onClick={handleCreate}
            className="w-full px-4 py-2 text-[13px] text-left text-neutral-200 hover:bg-neutral-800/60 transition-colors flex items-center gap-2"
          >
            <svg
              className="w-3.5 h-3.5 text-neutral-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <title>Create</title>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create &ldquo;{search.trim()}&rdquo;
          </button>
        )}

        {filteredDirs.map((dir) => {
          const isCurrent = dir.name === currentDirectoryName
          return (
            <button
              key={dir.id}
              type="button"
              onClick={() => handleSelect(dir.name)}
              className={`w-full px-4 py-2 text-[13px] text-left hover:bg-neutral-800/60 transition-colors flex items-center justify-between ${isCurrent ? 'text-neutral-100' : 'text-neutral-300'}`}
            >
              <span className="flex items-center gap-2">
                <svg
                  className="w-3.5 h-3.5 text-neutral-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <title>Folder</title>
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
                {dir.name}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">
                  {dir.fileCount.toLocaleString()}
                </span>
                {isCurrent && (
                  <svg
                    className="w-4 h-4 text-neutral-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <title>Current</title>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}
