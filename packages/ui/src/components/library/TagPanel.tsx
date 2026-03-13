import { useAllTags, useApp } from '@siastorage/core/stores'
import { useCallback, useState } from 'react'

type TagPanelProps = {
  selectedTag: string | null
  onSelectTag: (tagName: string | null) => void
}

export function TagPanel({ selectedTag, onSelectTag }: TagPanelProps) {
  const app = useApp()
  const { data: tagsData } = useAllTags()
  const tags = tagsData ?? []
  const [newTagName, setNewTagName] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  const handleAddTag = useCallback(async () => {
    const name = newTagName.trim()
    if (!name) return
    await app.tags.getOrCreate(name)
    setNewTagName('')
    setIsAdding(false)
  }, [newTagName, app])

  if (tags.length === 0 && !isAdding) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
          Tags
        </h3>
        <button
          type="button"
          onClick={() => setIsAdding(!isAdding)}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          {isAdding ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {isAdding && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleAddTag()
          }}
          className="flex gap-1"
        >
          <input
            type="text"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            placeholder="Tag name"
            className="flex-1 px-2 py-1 text-xs bg-neutral-800 border border-neutral-700 rounded text-white placeholder-neutral-500 outline-none focus:border-neutral-500"
          />
          <button
            type="submit"
            className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
          >
            Add
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-1.5">
        {selectedTag && (
          <button
            type="button"
            onClick={() => onSelectTag(null)}
            className="px-2 py-0.5 text-xs rounded-full bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            All
          </button>
        )}
        {tags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() =>
              onSelectTag(selectedTag === tag.name ? null : tag.name)
            }
            className={`group px-2 py-0.5 text-xs rounded-full transition-colors flex items-center gap-1 ${
              selectedTag === tag.name
                ? 'bg-green-600 text-white'
                : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <span>{tag.name}</span>
            <span className="text-neutral-500">({tag.fileCount})</span>
            {!tag.system && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  app.tags.delete(tag.id)
                  if (selectedTag === tag.name) onSelectTag(null)
                }}
                className="ml-0.5 opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400"
              >
                x
              </button>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
