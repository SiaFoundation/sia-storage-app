import { useAllDirectories } from '@siastorage/core/stores'

type DirectoryPanelProps = {
  selectedDirectory: string | null
  onSelectDirectory: (dirName: string | null) => void
}

export function DirectoryPanel({
  selectedDirectory,
  onSelectDirectory,
}: DirectoryPanelProps) {
  const { data: directoriesData } = useAllDirectories()
  const directories = directoriesData ?? []

  if (directories.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
        Folders
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {selectedDirectory && (
          <button
            type="button"
            onClick={() => onSelectDirectory(null)}
            className="px-2 py-0.5 text-xs rounded-full bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            All
          </button>
        )}
        {directories.map((dir) => (
          <button
            key={dir.id}
            type="button"
            onClick={() =>
              onSelectDirectory(
                selectedDirectory === dir.name ? null : dir.name,
              )
            }
            className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
              selectedDirectory === dir.name
                ? 'bg-green-600 text-white'
                : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {dir.name}{' '}
            <span className="text-neutral-500">
              ({dir.fileCount.toLocaleString()})
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
