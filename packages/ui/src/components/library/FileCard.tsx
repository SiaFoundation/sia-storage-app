import type { FileRecord } from '@siastorage/core/types'
import { FileTypeIcon } from './FileTypeIcon'
import { formatBytes } from './format'

type FileCardProps = {
  file: FileRecord
  thumbnailUrl?: string
  selected?: boolean
  selectionMode?: boolean
  onClick: () => void
  onSelect?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export function FileCard({
  file,
  thumbnailUrl,
  selected,
  selectionMode,
  onClick,
  onSelect,
  onContextMenu,
}: FileCardProps) {
  return (
    <button
      type="button"
      onClick={selectionMode ? onSelect : onClick}
      onContextMenu={onContextMenu}
      data-testid={`file-card-${file.id}`}
      className={`group relative aspect-square rounded-lg overflow-hidden cursor-pointer w-full text-left ${
        selected
          ? 'ring-2 ring-green-500 ring-offset-1 ring-offset-neutral-950'
          : ''
      }`}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={file.name}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-neutral-800 flex flex-col items-center justify-center gap-2">
          <FileTypeIcon
            mimeType={file.type}
            className="w-8 h-8 text-neutral-500"
          />
          <span className="text-xs text-neutral-500 px-2 text-center truncate max-w-full">
            {file.name}
          </span>
        </div>
      )}

      {(selectionMode || selected) && (
        <div className="absolute top-1.5 left-1.5 z-[1]">
          <span
            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shadow-sm ${
              selected
                ? 'bg-green-500 border-green-500'
                : 'border-white/70 bg-black/30'
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
        </div>
      )}

      {thumbnailUrl && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent pt-6 pb-1.5 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <p className="text-xs text-white/90 truncate">{file.name}</p>
          <p className="text-[10px] text-white/60">{formatBytes(file.size)}</p>
        </div>
      )}
    </button>
  )
}
