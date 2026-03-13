import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlatform } from '../../context/platform'
import { useModalStore } from '../../stores/modal'

type UploadMenuProps = {
  onLocalThumbnails?: (urls: Record<string, string>) => void
}

export function UploadMenu({ onLocalThumbnails }: UploadMenuProps) {
  const [open, setOpen] = useState(false)
  const openRecording = useModalStore((s) => s.openRecording)
  const ref = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

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

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white transition-colors rounded-lg"
          title="Upload"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <title>Add</title>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add files
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 min-w-[180px] bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                fileInputRef.current?.click()
              }}
              className="w-full text-left px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-neutral-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <title>Files</title>
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Files
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                folderInputRef.current?.click()
              }}
              className="w-full text-left px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-neutral-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <title>Folder</title>
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              Folder
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                cameraInputRef.current?.click()
              }}
              className="w-full text-left px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-neutral-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <title>Camera</title>
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Photo / Video
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                openRecording('screen')
              }}
              className="w-full text-left px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-neutral-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <title>Screen</title>
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              Screen Recording
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                openRecording('audio')
              }}
              className="w-full text-left px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700 flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-neutral-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <title>Microphone</title>
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                <path d="M19 10v2a7 7 0 01-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              Audio Recording
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is not in type defs
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </>
  )
}
