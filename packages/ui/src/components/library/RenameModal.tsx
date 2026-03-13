import { useEffect, useState } from 'react'
import { Dialog } from '../ui/Dialog'

type RenameModalProps = {
  open: boolean
  currentName: string
  onClose: () => void
  onRename: (newName: string) => void
}

export function RenameModal({
  open,
  currentName,
  onClose,
  onRename,
}: RenameModalProps) {
  const [name, setName] = useState(currentName)

  useEffect(() => {
    if (open) setName(currentName)
  }, [open, currentName])

  return (
    <Dialog open={open} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = name.trim()
          if (trimmed && trimmed !== currentName) {
            onRename(trimmed)
          }
          onClose()
        }}
      >
        <div className="px-4 pt-4 pb-3">
          <h2 className="text-[13px] font-medium text-neutral-100 mb-3">
            Rename
          </h2>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-2.5 py-1.5 text-[13px] bg-neutral-800/80 border border-neutral-700/50 rounded-md text-white placeholder-neutral-500 outline-none focus:border-neutral-600 transition-colors"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 px-4 pb-3.5">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[13px] text-neutral-400 hover:text-neutral-200 rounded-md hover:bg-neutral-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || name.trim() === currentName}
            className="px-3 py-1.5 text-[13px] font-medium bg-white hover:bg-neutral-200 text-neutral-900 rounded-md transition-colors disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </form>
    </Dialog>
  )
}
