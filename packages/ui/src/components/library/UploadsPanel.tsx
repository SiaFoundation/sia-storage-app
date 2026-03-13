import { useApp } from '@siastorage/core/stores'
import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { usePlatform } from '../../context/platform'
import { navigate } from '../../lib/router'
import { FileTypeIcon } from './FileTypeIcon'
import { formatBytes, formatFileType } from './format'

type LocalOnlyFile = {
  id: string
  name: string
  type: string
  size: number
}

export function useUploadsBadgeCount(): number {
  const app = useApp()
  const { data: uploadsMap = {} } = useSWR(
    app.caches.uploads.key('all'),
    () => app.uploads.getState().uploads,
  )
  const [localOnlyCount, setLocalOnlyCount] = useState(0)

  const uploads = Object.values(uploadsMap)
  const uploadsLength = uploads.length
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-query when uploads change
  useEffect(() => {
    app.files.getUnuploadedCount().then(setLocalOnlyCount)
  }, [uploadsLength, app])

  const activeCount = uploads.filter(
    (u) =>
      u.status === 'uploading' ||
      u.status === 'queued' ||
      u.status === 'packing' ||
      u.status === 'packed',
  ).length

  return activeCount + localOnlyCount
}

function UploadListRow({
  name,
  type,
  size,
  fileId,
  trailing,
}: {
  name: string
  type: string
  size: number
  fileId?: string
  trailing?: React.ReactNode
}) {
  const handleClick = fileId ? () => navigate(`#/file/${fileId}`) : undefined

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`w-full flex items-center gap-3 px-3 h-11 text-left border-b border-neutral-800/50 ${handleClick ? 'hover:bg-white/[0.03] transition-colors' : 'cursor-default'}`}
    >
      <div className="w-9 h-9 rounded-md bg-neutral-800 flex-shrink-0 flex items-center justify-center">
        <FileTypeIcon mimeType={type} className="w-5 h-5 text-neutral-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-neutral-200 truncate">{name}</p>
      </div>
      <span className="text-xs text-neutral-500 w-28 text-right flex-shrink-0 hidden sm:block truncate">
        {formatFileType(type)}
      </span>
      <span className="text-xs text-neutral-400 w-20 text-right flex-shrink-0 tabular-nums">
        {formatBytes(size)}
      </span>
      {trailing && (
        <span className="w-20 flex-shrink-0 flex justify-end">{trailing}</span>
      )}
    </button>
  )
}

export function UploadsPanel() {
  const platform = usePlatform()
  const app = useApp()
  const { data: uploadsMap = {} } = useSWR(
    app.caches.uploads.key('all'),
    () => app.uploads.getState().uploads,
  )
  const [localOnlyFiles, setLocalOnlyFiles] = useState<LocalOnlyFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploads = Object.values(uploadsMap)

  const handleFiles = useCallback(
    (fileList: FileList) => {
      const files = Array.from(fileList)
      if (files.length > 0) {
        platform.uploadFiles(files)
      }
    },
    [platform],
  )

  const uploadsLen = uploads.length
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-query when uploads change
  useEffect(() => {
    app.files.getUnuploaded().then(setLocalOnlyFiles)
  }, [uploadsLen, app])

  const activeUploads = uploads.filter(
    (u) =>
      u.status === 'uploading' ||
      u.status === 'queued' ||
      u.status === 'packing' ||
      u.status === 'packed',
  )
  const completedUploads = uploads.filter(
    (u) => u.status === 'done' || u.status === 'error',
  )

  const handleDeleteAllLost = async () => {
    await app.files.trash(localOnlyFiles.map((f) => f.id))
    setLocalOnlyFiles([])
    app.caches.libraryVersion.invalidate()
  }

  if (uploads.length === 0 && localOnlyFiles.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-16">
          <svg
            className="w-10 h-10 text-neutral-600 mb-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <title>Uploads</title>
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="text-neutral-500 text-sm mb-4">
            No uploads or local files
          </p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-1.5"
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
      </>
    )
  }

  return (
    <div>
      {activeUploads.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-neutral-300">
              In Progress ({activeUploads.length.toLocaleString()})
            </h3>
            <span />
          </div>
          <div>
            {activeUploads.map((u) => (
              <UploadListRow
                key={u.id}
                name={u.name ?? u.id}
                type="application/octet-stream"
                size={u.size}
                fileId={u.id}
                trailing={
                  <div className="flex items-center gap-2">
                    <div className="w-12 h-1 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 transition-all"
                        style={{
                          width: `${Math.round(u.progress * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-neutral-400 tabular-nums">
                      {Math.round(u.progress * 100)}%
                    </span>
                  </div>
                }
              />
            ))}
          </div>
        </div>
      )}

      {completedUploads.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-neutral-300">
              Completed ({completedUploads.length.toLocaleString()})
            </h3>
            <button
              type="button"
              onClick={() => {
                const current = app.uploads.getState().uploads
                const doneIds = Object.keys(current).filter(
                  (id) => current[id].status === 'done',
                )
                app.uploads.removeMany(doneIds)
              }}
              className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              Clear
            </button>
          </div>
          <div>
            {completedUploads.map((u) => (
              <UploadListRow
                key={u.id}
                name={u.name ?? u.id}
                type="application/octet-stream"
                size={u.size}
                fileId={u.id}
                trailing={
                  <span
                    className={`text-xs ${u.status === 'done' ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {u.status === 'done' ? 'Done' : 'Failed'}
                  </span>
                }
              />
            ))}
          </div>
        </div>
      )}

      {localOnlyFiles.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-medium text-neutral-300">
                Lost Files ({localOnlyFiles.length.toLocaleString()})
              </h3>
              <p className="text-xs text-neutral-500">
                Files not uploaded to the network
              </p>
            </div>
            <button
              type="button"
              onClick={handleDeleteAllLost}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Delete All
            </button>
          </div>
          <div>
            {localOnlyFiles.map((f) => (
              <UploadListRow
                key={f.id}
                name={f.name}
                type={f.type}
                size={f.size}
                fileId={f.id}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
