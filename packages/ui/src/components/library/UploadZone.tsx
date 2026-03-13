import { useCallback, useRef, useState } from 'react'
import { usePlatform } from '../../context/platform'

type UploadZoneProps = {
  children: React.ReactNode
  onLocalThumbnails?: (urls: Record<string, string>) => void
}

export function UploadZone({ children, onLocalThumbnails }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)
  const platform = usePlatform()

  const handleFiles = useCallback(
    (fileList: FileList) => {
      const files = Array.from(fileList)
      if (files.length > 0) {
        platform.uploadFiles(files).then((localUrls) => {
          if (onLocalThumbnails && Object.keys(localUrls).length > 0) {
            onLocalThumbnails(localUrls)
          }
        })
      }
    },
    [onLocalThumbnails, platform],
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    if (dragCounter.current === 1) {
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setIsDragging(false)
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files)
      }
    },
    [handleFiles],
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Drop zone requires drag event handlers
    <div
      role="presentation"
      className="relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {isDragging && (
        <div className="fixed inset-0 z-50 bg-green-900/30 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="bg-neutral-900 border-2 border-dashed border-green-500 rounded-2xl p-12 text-center">
            <svg
              className="w-12 h-12 mx-auto mb-4 text-green-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <title>Drop files</title>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-lg text-green-300">Drop files to upload</p>
          </div>
        </div>
      )}
    </div>
  )
}
