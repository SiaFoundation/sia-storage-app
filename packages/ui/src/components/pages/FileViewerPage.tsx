import { useAllDirectories, useApp } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlatform } from '../../context/platform'
import { detectMimeType } from '../../lib/detectMimeType'
import { navigate } from '../../lib/router'
import { useToastStore } from '../../stores/toast'
import { formatBytes, formatFileType } from '../library/format'
import { ManageTagsModal } from '../library/ManageTagsModal'
import { MoveToDirectoryModal } from '../library/MoveToDirectoryModal'
import { AudioViewer } from '../library/viewers/AudioViewer'
import { CodeViewer } from '../library/viewers/CodeViewer'
import { ImageViewer } from '../library/viewers/ImageViewer'
import { MarkdownViewer } from '../library/viewers/MarkdownViewer'
import { PDFViewer } from '../library/viewers/PDFViewer'
import { TextViewer } from '../library/viewers/TextViewer'
import { UnknownViewer } from '../library/viewers/UnknownViewer'
import { VideoViewer } from '../library/viewers/VideoViewer'
import { BlocksLoader } from '../ui/BlocksLoader'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { DropdownMenu } from '../ui/DropdownMenu'

const codeMimeTypes = new Set([
  'application/json',
  'text/javascript',
  'text/css',
  'text/html',
  'application/javascript',
  'application/xml',
  'text/xml',
])

function getViewerType(
  mimeType: string,
  name: string,
):
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'markdown'
  | 'code'
  | 'text'
  | 'unknown' {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType === 'application/pdf') return 'pdf'
  if (
    mimeType === 'text/markdown' ||
    name.endsWith('.md') ||
    name.endsWith('.markdown')
  )
    return 'markdown'
  if (codeMimeTypes.has(mimeType) || name.endsWith('.json')) return 'code'
  if (mimeType.startsWith('text/')) return 'text'
  return 'unknown'
}

export function FileViewerPage({ fileId }: { fileId: string }) {
  const platform = usePlatform()
  const app = useApp()

  if (!fileId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">No file ID provided</p>
      </div>
    )
  }

  return <FileViewerPageInner fileId={fileId} platform={platform} app={app} />
}

function FileViewerPageInner({
  fileId,
  platform,
  app: svc,
}: {
  fileId: string
  platform: ReturnType<typeof usePlatform>
  app: ReturnType<typeof useApp>
}) {
  const [file, setFile] = useState<FileRecord | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null)
  const [tagNames, setTagNames] = useState<string[]>([])
  const [directoryName, setDirectoryName] = useState<string | undefined>()
  const [infoOpen, setInfoOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  const [manageTagsOpen, setManageTagsOpen] = useState(false)
  const [moveToDirectoryOpen, setMoveToDirectoryOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { data: directoriesData } = useAllDirectories()
  const directories = directoriesData ?? []
  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    svc.files
      .getById(fileId)
      .then((record) => {
        if (record) setFile(record)
        else {
          setError('File not found')
          setLoading(false)
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load file')
        setLoading(false)
      })
  }, [fileId, svc])

  const [detectedType, setDetectedType] = useState<string | null>(null)
  const [downloadAttempt, setDownloadAttempt] = useState(0)

  const retryDownload = useCallback(async () => {
    if (!file) return
    setDownloadAttempt((n) => n + 1)
  }, [file])

  // biome-ignore lint/correctness/useExhaustiveDependencies: downloadAttempt triggers re-download after cache clear
  useEffect(() => {
    if (!file) return
    let cancelled = false
    let url: string | null = null

    async function download() {
      setLoading(true)
      setError(null)

      try {
        await svc.downloads.downloadFile(file!.id)
        if (cancelled) return
        const data = await svc.downloads.readFile(file!.id)
        if (cancelled) return

        setFileData(data)
        setDetectedType(detectMimeType(data))
        url = platform.createBlobUrl(data, file!.type)
        setObjectUrl(url)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Download failed')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    download()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file, downloadAttempt])

  useEffect(() => {
    if (!file) return
    svc.tags.getNamesForFile(file.id).then((names) => setTagNames(names ?? []))
    svc.directories.getNameForFile(file.id).then(setDirectoryName)
  }, [file, svc])

  const prevFileId = null
  const nextFileId = null

  const goBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      navigate('#/')
    }
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return
      if (e.key === 'Escape') goBack()
      if (e.key === 'ArrowLeft' && prevFileId) navigate(`#/file/${prevFileId}`)
      if (e.key === 'ArrowRight' && nextFileId) navigate(`#/file/${nextFileId}`)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goBack])

  const isFavorite = tagNames.includes('Favorites')

  const handleToggleFavorite = useCallback(async () => {
    if (!file) return
    await svc.tags.toggleFavorite(file.id)
    const names = await svc.tags.getNamesForFile(file.id)
    setTagNames(names ?? [])
    addToast('Favorites updated')
  }, [file, svc, addToast])

  const handleDownload = useCallback(() => {
    if (fileData && file) {
      platform.saveFileToDisk(fileData, file.name, file.type)
    }
  }, [fileData, file, platform])

  const handleRename = useCallback(
    async (newName: string) => {
      if (!file) return
      await svc.files.update({
        id: file.id,
        name: newName,
        updatedAt: Date.now(),
      })
      setFile((prev) => (prev ? { ...prev, name: newName } : prev))
      addToast('File renamed')
    },
    [svc, file, addToast],
  )

  const handleDelete = useCallback(async () => {
    if (!file) return
    await svc.files.trash([file.id])
    addToast('File moved to trash')
    goBack()
  }, [svc, file, addToast, goBack])

  const handleFixType = useCallback(
    async (newType: string) => {
      if (!file) return
      await svc.files.update({
        id: file.id,
        type: newType,
        updatedAt: Date.now(),
      })
      setFile((prev) => (prev ? { ...prev, type: newType } : prev))
      if (fileData) {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        setObjectUrl(platform.createBlobUrl(fileData, newType))
      }
      addToast('File type updated')
    },
    [svc, file, fileData, objectUrl, platform, addToast],
  )

  const startRename = useCallback(() => {
    if (!file) return
    setRenameValue(file.name)
    setIsRenaming(true)
    requestAnimationFrame(() => {
      const input = renameInputRef.current
      if (input) {
        input.focus()
        const dotIndex = file.name.lastIndexOf('.')
        if (dotIndex > 0) {
          input.setSelectionRange(0, dotIndex)
        } else {
          input.select()
        }
      }
    })
  }, [file])

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && file && trimmed !== file.name) {
      handleRename(trimmed)
    }
    setIsRenaming(false)
  }, [renameValue, file, handleRename])

  const cancelRename = useCallback(() => {
    setIsRenaming(false)
  }, [])

  if (!file && !error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <BlocksLoader label="Loading..." />
      </div>
    )
  }

  if (error && !file) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">{error}</p>
        <button
          type="button"
          onClick={goBack}
          className="px-4 py-2 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors"
        >
          Go Back
        </button>
      </div>
    )
  }

  if (!file) return null

  const viewerType = getViewerType(file.type, file.name)

  const dir = directoryName
    ? directories.find((d) => d.name === directoryName)
    : null

  const breadcrumbParent = dir
    ? { label: dir.name, path: `#/dir/${dir.id}` }
    : directoryName
      ? { label: directoryName }
      : null

  return (
    <>
      <div className="sticky top-12 z-10 shrink-0 h-12 flex items-center gap-2 px-4 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-sm">
        <button
          type="button"
          onClick={goBack}
          className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors"
          title="Back"
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <title>Back</title>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <nav className="min-w-0 flex-1 flex items-center gap-1.5 text-sm">
          <button
            type="button"
            onClick={() => navigate('#/files')}
            className="text-neutral-400 hover:text-neutral-200 transition-colors flex-shrink-0"
          >
            Files
          </button>
          {breadcrumbParent && (
            <>
              <span className="text-neutral-600 flex-shrink-0">/</span>
              {breadcrumbParent.path ? (
                <button
                  type="button"
                  onClick={() => navigate(breadcrumbParent.path!)}
                  className="text-neutral-400 hover:text-neutral-200 transition-colors truncate"
                >
                  {breadcrumbParent.label}
                </button>
              ) : (
                <span className="text-neutral-400 truncate">
                  {breadcrumbParent.label}
                </span>
              )}
            </>
          )}
          <span className="text-neutral-600 flex-shrink-0">/</span>
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') cancelRename()
              }}
              onBlur={commitRename}
              className="bg-neutral-800 border border-neutral-600 rounded px-1.5 py-0.5 text-sm text-white outline-none focus:border-neutral-400 min-w-0 max-w-[300px]"
            />
          ) : (
            <button
              type="button"
              onClick={startRename}
              className="text-white font-medium truncate hover:text-green-300 transition-colors"
              title="Click to rename"
            >
              {file.name}
            </button>
          )}
        </nav>

        <div className="flex items-center gap-0.5">
          <span className="text-[11px] text-neutral-500 flex-shrink-0 hidden sm:inline mr-1">
            {formatFileType(file.type)} &middot; {formatBytes(file.size)}
          </span>
          <button
            type="button"
            onClick={() => setInfoOpen((o) => !o)}
            className={`p-2 rounded-lg transition-colors ${
              infoOpen
                ? 'text-green-400 bg-neutral-800'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Info"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <title>Info</title>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </button>

          <button
            type="button"
            onClick={handleToggleFavorite}
            className={`p-2 rounded-lg transition-colors ${
              isFavorite
                ? 'text-red-400 hover:text-red-300'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title={isFavorite ? 'Unfavorite' : 'Favorite'}
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill={isFavorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            >
              <title>Favorite</title>
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </button>

          {fileData && (
            <button
              type="button"
              onClick={handleDownload}
              className="p-2 text-neutral-400 hover:text-neutral-200 rounded-lg transition-colors"
              title="Download"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <title>Download</title>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          )}

          <button
            type="button"
            onClick={() => setManageTagsOpen(true)}
            className="p-2 text-neutral-400 hover:text-neutral-200 rounded-lg transition-colors hidden md:block"
            title="Manage tags"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <title>Tags</title>
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setMoveToDirectoryOpen(true)}
            className="p-2 text-neutral-400 hover:text-neutral-200 rounded-lg transition-colors hidden md:block"
            title="Move to folder"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <title>Move</title>
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              <polyline points="12 11 12 17" />
              <polyline points="9 14 12 11 15 14" />
            </svg>
          </button>

          <button
            type="button"
            onClick={startRename}
            className="p-2 text-neutral-400 hover:text-neutral-200 rounded-lg transition-colors hidden md:block"
            title="Rename"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <title>Rename</title>
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="p-2 text-red-400 hover:text-red-300 rounded-lg transition-colors hidden md:block"
            title="Delete"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <title>Delete</title>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>

          <div className="md:hidden">
            <DropdownMenu
              items={[
                {
                  label: 'Manage tags',
                  onClick: () => setManageTagsOpen(true),
                },
                {
                  label: 'Move to folder',
                  onClick: () => setMoveToDirectoryOpen(true),
                },
                { label: 'Rename', onClick: startRename },
                {
                  label: 'Delete',
                  onClick: () => setDeleteOpen(true),
                  destructive: true,
                },
              ]}
            />
          </div>
        </div>
      </div>

      <div
        className="flex-1 flex overflow-hidden relative"
        style={{ height: 'calc(100vh - 96px)' }}
      >
        <div className="flex-1 flex flex-col overflow-hidden">
          {detectedType && file && detectedType !== file.type && (
            <div className="shrink-0 mx-4 mt-2 px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/40 flex items-center justify-between gap-3">
              <p className="text-amber-300/90 text-xs">
                This file appears to be {formatFileType(detectedType)} (recorded
                as {formatFileType(file.type)})
              </p>
              <button
                type="button"
                onClick={() => handleFixType(detectedType)}
                className="shrink-0 px-3 py-1 text-xs bg-amber-800/50 hover:bg-amber-700/50 text-amber-200 rounded transition-colors"
              >
                Update to {formatFileType(detectedType)}
              </button>
            </div>
          )}
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <BlocksLoader label="Downloading..." />
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          ) : objectUrl ? (
            <FileViewer
              viewerType={viewerType}
              url={objectUrl}
              file={file}
              fileData={fileData}
              onRetry={retryDownload}
            />
          ) : null}

          {prevFileId && (
            <button
              type="button"
              onClick={() => navigate(`#/file/${prevFileId}`)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-neutral-500 hover:text-white bg-neutral-900/60 hover:bg-neutral-800/80 rounded-full transition-all opacity-0 hover:opacity-100 focus:opacity-100"
              style={{ opacity: undefined }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0'
              }}
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <title>Previous</title>
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          {nextFileId && (
            <button
              type="button"
              onClick={() => navigate(`#/file/${nextFileId}`)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-neutral-500 hover:text-white bg-neutral-900/60 hover:bg-neutral-800/80 rounded-full transition-all"
              style={{ opacity: 0 }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0'
              }}
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <title>Next</title>
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </button>
          )}
        </div>

        {infoOpen && (
          <aside className="w-72 shrink-0 border-l border-neutral-800 bg-neutral-950 overflow-y-auto p-4">
            <h2 className="text-sm font-medium text-neutral-300 mb-3">Info</h2>
            <dl className="space-y-2 text-sm">
              <InfoRow label="Name" value={file.name} />
              <InfoRow label="Type" value={formatFileType(file.type)} />
              <InfoRow label="Size" value={formatBytes(file.size)} />
              {file.hash && <InfoRow label="Hash" value={file.hash} mono />}
              {file.createdAt && (
                <InfoRow
                  label="Created"
                  value={new Date(file.createdAt).toLocaleDateString()}
                />
              )}
              <InfoRow
                label="Updated"
                value={new Date(file.updatedAt).toLocaleDateString()}
              />
              {directoryName && (
                <InfoRow label="Folder" value={directoryName} />
              )}
            </dl>

            {tagNames.length > 0 && (
              <div className="mt-4 pt-4 border-t border-neutral-800">
                <p className="text-xs text-neutral-500 mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {tagNames.map((name) => (
                    <span
                      key={name}
                      className="px-2 py-0.5 text-xs bg-neutral-800 text-neutral-300 rounded-full"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      <ManageTagsModal
        open={manageTagsOpen}
        fileId={file.id}
        onClose={() => {
          setManageTagsOpen(false)
          svc.tags
            .getNamesForFile(file.id)
            .then((names) => setTagNames(names ?? []))
        }}
      />

      <MoveToDirectoryModal
        open={moveToDirectoryOpen}
        fileIds={[file.id]}
        currentDirectoryName={directoryName}
        onClose={() => setMoveToDirectoryOpen(false)}
        onMoved={() => {
          svc.caches.libraryVersion.invalidate()
          svc.directories.getNameForFile(file.id).then(setDirectoryName)
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete File"
        message={`Delete "${file.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          handleDelete()
          setDeleteOpen(false)
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  )
}

function FileViewer({
  viewerType,
  url,
  file,
  fileData,
  onRetry,
}: {
  viewerType: string
  url: string
  file: FileRecord
  fileData: ArrayBuffer | null
  onRetry?: () => void
}) {
  switch (viewerType) {
    case 'image':
      return (
        <ImageViewer
          url={url}
          name={file.name}
          mimeType={file.type}
          fileData={fileData}
          onRetry={onRetry}
        />
      )
    case 'video':
      return <VideoViewer url={url} />
    case 'audio':
      return <AudioViewer url={url} name={file.name} />
    case 'pdf':
      return <PDFViewer url={url} name={file.name} />
    case 'markdown':
      return <MarkdownViewer url={url} />
    case 'code':
      return <CodeViewer url={url} mimeType={file.type} name={file.name} />
    case 'text':
      return <TextViewer url={url} />
    default:
      return (
        <UnknownViewer
          name={file.name}
          mimeType={file.type}
          size={file.size}
          fileData={fileData}
        />
      )
  }
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-neutral-500 text-xs">{label}</dt>
      <dd
        className={`text-neutral-300 text-sm truncate ${mono ? 'font-mono text-xs' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}
