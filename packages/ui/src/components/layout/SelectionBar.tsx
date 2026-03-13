import { useFileSelectionStore } from '../../stores/fileSelection'
import { useModalStore } from '../../stores/modal'

type SelectionBarProps = {
  allFileIds: string[]
}

export function SelectionBar({ allFileIds }: SelectionBarProps) {
  const selectedFileIds = useFileSelectionStore((s) => s.selectedFileIds)
  const exitSelectionMode = useFileSelectionStore((s) => s.exitSelectionMode)
  const selectAll = useFileSelectionStore((s) => s.selectAll)
  const clearSelection = useFileSelectionStore((s) => s.clearSelection)
  const openMoveToDirectory = useModalStore((s) => s.openMoveToDirectory)
  const openDelete = useModalStore((s) => s.openDelete)

  const selectedCount = selectedFileIds.length

  return (
    <div
      className="sticky top-12 z-10 bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-800"
      data-testid="selection-bar"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 sm:py-0 sm:h-10 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => openMoveToDirectory(selectedFileIds)}
          disabled={selectedCount === 0}
          className="px-2 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition-colors disabled:opacity-30"
        >
          Move
        </button>
        <button
          type="button"
          onClick={() =>
            openDelete({
              type: 'files',
              ids: selectedFileIds,
              label: `${selectedCount.toLocaleString()} file${selectedCount !== 1 ? 's' : ''}`,
            })
          }
          disabled={selectedCount === 0}
          className="px-2 py-1 text-xs bg-red-900/50 hover:bg-red-900/70 text-red-300 rounded transition-colors disabled:opacity-30"
        >
          Delete
        </button>

        <div className="flex-1" />

        <span className="text-sm text-neutral-300">
          {selectedCount.toLocaleString()} selected
        </span>
        <button
          type="button"
          onClick={clearSelection}
          disabled={selectedCount === 0}
          className="px-2 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition-colors disabled:opacity-30"
        >
          Clear All
        </button>
        <button
          type="button"
          onClick={() => selectAll(allFileIds)}
          className="px-2 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition-colors"
        >
          Select All
        </button>
        <button
          type="button"
          onClick={exitSelectionMode}
          className="text-neutral-400 hover:text-neutral-200 p-1"
          title="Exit selection"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <title>Exit selection</title>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
