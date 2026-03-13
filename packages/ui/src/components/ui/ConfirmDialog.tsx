import { useEffect, useRef } from 'react'
import { Dialog } from './Dialog'

type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) confirmRef.current?.focus()
  }, [open])

  return (
    <Dialog open={open} onClose={onCancel}>
      <div className="px-4 pt-4 pb-3">
        <h2 className="text-[13px] font-medium text-neutral-100 mb-1.5">
          {title}
        </h2>
        <p className="text-[13px] text-neutral-400 leading-relaxed">
          {message}
        </p>
      </div>
      <div className="flex justify-end gap-2 px-4 pb-3.5">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-[13px] text-neutral-400 hover:text-neutral-200 rounded-md hover:bg-neutral-800 transition-colors"
        >
          {cancelLabel}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className={`px-3 py-1.5 text-[13px] rounded-md font-medium transition-colors ${
            destructive
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-white hover:bg-neutral-200 text-neutral-900'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
