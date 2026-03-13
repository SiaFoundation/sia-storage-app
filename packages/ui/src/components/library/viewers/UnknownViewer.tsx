import { useContext } from 'react'
import { PlatformContext } from '../../../context/platform'
import { formatBytes } from '../format'

export function UnknownViewer({
  name,
  mimeType,
  size,
  fileData,
}: {
  name: string
  mimeType: string
  size: number
  fileData: ArrayBuffer | null
}) {
  const platform = useContext(PlatformContext)

  return (
    <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
      <div className="text-center">
        <svg
          className="w-16 h-16 mx-auto mb-4 text-neutral-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <title>File</title>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <p className="text-sm text-neutral-300 mb-1">{name}</p>
        <p className="text-xs text-neutral-500 mb-1">{mimeType}</p>
        <p className="text-xs text-neutral-500 mb-4">{formatBytes(size)}</p>
        {fileData && (
          <button
            type="button"
            onClick={() => platform?.saveFileToDisk(fileData, name, mimeType)}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors"
          >
            Download File
          </button>
        )}
      </div>
    </div>
  )
}
