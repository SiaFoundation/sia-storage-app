import { useEffect, useRef, useState } from 'react'

type MenuItem = {
  label: string
  onClick: () => void
  destructive?: boolean
}

type DropdownMenuProps = {
  items: MenuItem[]
  trigger?: React.ReactNode
}

export function DropdownMenu({ items, trigger }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors rounded-lg hover:bg-neutral-800"
      >
        {trigger ?? (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <title>More actions</title>
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[160px] bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                item.destructive
                  ? 'text-red-400 hover:bg-red-900/30'
                  : 'text-neutral-200 hover:bg-neutral-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
