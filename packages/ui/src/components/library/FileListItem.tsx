import type { FileRecord } from '@siastorage/core/types'
import { FileTypeIcon } from './FileTypeIcon'
import { formatBytes, formatDate, formatFileType } from './format'

type FileListItemProps = {
  file: FileRecord
  thumbnailUrl?: string
  selected?: boolean
  selectionMode?: boolean
  onClick: () => void
  onSelect?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export function FileListItem({
  file,
  thumbnailUrl,
  selected,
  selectionMode,
  onClick,
  onSelect,
  onContextMenu,
}: FileListItemProps) {
  return (
    <button
      type="button"
      onClick={selectionMode ? onSelect : onClick}
      onContextMenu={onContextMenu}
      className={`w-full flex items-center gap-3 px-3 h-11 hover:bg-white/[0.03] transition-colors text-left border-b border-neutral-800/50 ${
        selected ? 'bg-green-900/20' : ''
      }`}
    >
      {selectionMode && (
        <span
          className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
            selected ? 'bg-green-600 border-green-600' : 'border-neutral-600'
          }`}
        >
          {selected && (
            <svg
              className="w-3 h-3 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            >
              <title>Selected</title>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
      )}

      <div className="w-9 h-9 rounded-md bg-neutral-800 flex-shrink-0 flex items-center justify-center overflow-hidden">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <FileTypeIcon
            mimeType={file.type}
            className="w-5 h-5 text-neutral-500"
          />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-neutral-200 truncate">{file.name}</p>
      </div>

      <span className="text-xs text-neutral-500 w-28 text-right flex-shrink-0 hidden sm:block truncate">
        {formatFileType(file.type)}
      </span>

      <span className="text-xs text-neutral-400 w-20 text-right flex-shrink-0 tabular-nums">
        {formatBytes(file.size)}
      </span>

      <span className="text-xs text-neutral-500 w-28 text-right flex-shrink-0 hidden md:block">
        {formatDate(file.createdAt)}
      </span>
    </button>
  )
}
