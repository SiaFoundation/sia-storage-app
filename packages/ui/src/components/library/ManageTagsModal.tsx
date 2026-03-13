import { useAllTags, useApp } from '@siastorage/core/stores'
import { useEffect, useMemo, useState } from 'react'
import { useToastStore } from '../../stores/toast'
import { Dialog, DialogHeader } from '../ui/Dialog'

type ManageTagsModalProps = {
  open: boolean
  fileId: string
  onClose: () => void
}

export function ManageTagsModal({
  open,
  fileId,
  onClose,
}: ManageTagsModalProps) {
  const app = useApp()
  const { data: tagsData } = useAllTags()
  const tags = tagsData ?? []
  const addToast = useToastStore((s) => s.addToast)
  const [fileTagNames, setFileTagNames] = useState<string[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) return
    app.tags
      .getNamesForFile(fileId)
      .then((names) => setFileTagNames(names ?? []))
  }, [open, fileId, app])

  const filteredTags = useMemo(() => {
    if (!search.trim()) return tags
    const q = search.toLowerCase()
    return tags.filter((t) => t.name.toLowerCase().includes(q))
  }, [tags, search])

  const exactMatch = tags.some(
    (t) => t.name.toLowerCase() === search.trim().toLowerCase(),
  )

  async function handleToggle(tagName: string) {
    if (fileTagNames.includes(tagName)) {
      const tag = tags.find((t) => t.name === tagName)
      if (tag) {
        await app.tags.remove(fileId, tag.id)
      }
      setFileTagNames((prev) => prev.filter((n) => n !== tagName))
      addToast(`Removed tag "${tagName}"`)
    } else {
      await app.tags.add(fileId, tagName)
      setFileTagNames((prev) => [...prev, tagName])
      addToast(`Added tag "${tagName}"`)
    }
  }

  async function handleCreate() {
    const name = search.trim()
    if (!name) return
    await app.tags.getOrCreate(name)
    await app.tags.add(fileId, name)
    setFileTagNames((prev) => [...prev, name])
    setSearch('')
    addToast(`Created and added tag "${name}"`)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="max-w-md"
      className="max-h-[80vh] flex flex-col"
    >
      <DialogHeader title="Manage Tags" onClose={onClose} />

      {fileTagNames.length > 0 && (
        <div className="px-4 py-3 border-b border-neutral-800/80 flex flex-wrap gap-1.5">
          {fileTagNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => handleToggle(name)}
              className="px-2 py-0.5 text-xs bg-neutral-800 text-neutral-300 rounded-md flex items-center gap-1 hover:bg-neutral-700 transition-colors"
            >
              {name}
              <svg
                className="w-3 h-3 text-neutral-500"
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
        </div>
      )}

      <div className="px-4 py-3 border-b border-neutral-800/80">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search or create tag..."
          className="w-full px-2.5 py-1.5 text-[13px] bg-neutral-800/80 border border-neutral-700/50 rounded-md text-white placeholder-neutral-500 outline-none focus:border-neutral-600 transition-colors"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
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
        {filteredTags.map((tag) => {
          const isAssigned = fileTagNames.includes(tag.name)
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => handleToggle(tag.name)}
              className="w-full px-4 py-2 text-[13px] text-left hover:bg-neutral-800/60 transition-colors flex items-center justify-between"
            >
              <span
                className={isAssigned ? 'text-neutral-100' : 'text-neutral-400'}
              >
                {tag.name}
              </span>
              {isAssigned && (
                <svg
                  className="w-4 h-4 text-neutral-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <title>Assigned</title>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          )
        })}
      </div>
    </Dialog>
  )
}
