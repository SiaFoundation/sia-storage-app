import { useApp } from '@siastorage/core/stores'
import { useEffect, useState } from 'react'
import { useModalStore } from '../../stores/modal'
import { useToastStore } from '../../stores/toast'
import { Dialog } from '../ui/Dialog'

export function CreateTagDialog() {
  const app = useApp()
  const open = useModalStore((s) => s.createTagOpen)
  const onClose = useModalStore((s) => s.closeCreateTag)
  const addToast = useToastStore((s) => s.addToast)
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName('')
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await app.tags.getOrCreate(trimmed)
      addToast(`Created tag "${trimmed}"`)
      onClose()
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to create tag',
        'error',
      )
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="px-4 pt-4 pb-3">
          <h2 className="text-[13px] font-medium text-neutral-100 mb-3">
            New Tag
          </h2>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tag name"
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
            disabled={!name.trim()}
            className="px-3 py-1.5 text-[13px] font-medium bg-white hover:bg-neutral-200 text-neutral-900 rounded-md transition-colors disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </form>
    </Dialog>
  )
}
