import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'

type DialogProps = {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  maxWidth?: string
  className?: string
}

export function Dialog({
  open,
  onClose,
  children,
  maxWidth = 'max-w-sm',
  className,
}: DialogProps) {
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <motion.div
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            onClick={onClose}
          />
          <motion.div
            className={`relative bg-neutral-900 border border-neutral-800/80 rounded-t-xl sm:rounded-xl shadow-2xl shadow-black/50 overflow-hidden w-full mx-0 sm:mx-4 sm:w-auto sm:min-w-0 ${maxWidth} ${className ?? ''}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.1 }}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

type DialogHeaderProps = {
  title: string
  onClose: () => void
}

export function DialogHeader({ title, onClose }: DialogHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800/80">
      <h2 className="text-[13px] font-medium text-neutral-100">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        className="-mr-1 p-1 text-neutral-500 hover:text-neutral-300 rounded-md hover:bg-neutral-800 transition-colors"
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <title>Close</title>
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
