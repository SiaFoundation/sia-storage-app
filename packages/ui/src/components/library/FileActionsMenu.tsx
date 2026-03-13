import { useEffect, useRef } from 'react'

type FileActionsMenuProps = {
  position: { x: number; y: number }
  isFavorite: boolean
  onClose: () => void
  onDownload: () => void
  onToggleFavorite: () => void
  onManageTags: () => void
  onMoveToDirectory: () => void
  onRename: () => void
  onDelete: () => void
}

export function FileActionsMenu({
  position,
  isFavorite,
  onClose,
  onDownload,
  onToggleFavorite,
  onManageTags,
  onMoveToDirectory,
  onRename,
  onDelete,
}: FileActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y,
  }

  return (
    <div
      ref={menuRef}
      style={menuStyle}
      className="z-50 w-52 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl py-1.5 overflow-hidden"
      data-testid="file-actions-menu"
    >
      <MenuItem
        icon={
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
        }
        label="Download"
        testId="action-download"
        onClick={() => {
          onDownload()
          onClose()
        }}
      />
      <MenuItem
        icon={
          isFavorite ? (
            <path
              d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
              fill="currentColor"
            />
          ) : (
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
          )
        }
        label={isFavorite ? 'Unfavorite' : 'Favorite'}
        testId="action-favorite"
        onClick={() => {
          onToggleFavorite()
          onClose()
        }}
      />

      <div className="my-1 border-t border-neutral-800" />

      <MenuItem
        icon={
          <>
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </>
        }
        label="Manage Tags"
        testId="action-manage-tags"
        onClick={() => {
          onManageTags()
          onClose()
        }}
      />
      <MenuItem
        icon={
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        }
        label="Move to Folder"
        testId="action-move"
        onClick={() => {
          onMoveToDirectory()
          onClose()
        }}
      />
      <MenuItem
        icon={<path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />}
        label="Rename"
        testId="action-rename"
        onClick={() => {
          onRename()
          onClose()
        }}
      />

      <div className="my-1 border-t border-neutral-800" />

      <MenuItem
        icon={
          <>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </>
        }
        label="Delete"
        testId="action-delete"
        destructive
        onClick={() => {
          onDelete()
          onClose()
        }}
      />
    </div>
  )
}

function MenuItem({
  icon,
  label,
  testId,
  destructive,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  testId?: string
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`w-full px-3 py-2 text-sm text-left flex items-center gap-2.5 hover:bg-neutral-800 transition-colors ${
        destructive
          ? 'text-red-400 hover:text-red-300'
          : 'text-neutral-300 hover:text-white'
      }`}
    >
      <svg
        className="w-4 h-4 flex-shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <title>{label}</title>
        {icon}
      </svg>
      {label}
    </button>
  )
}
