import { createRoot } from 'react-dom/client'
import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import { fetchPath, fetchMetadata, type DirectoryResponse, type ShareMetadata } from './lib/api'
import { Breadcrumbs } from './components/breadcrumbs'
import { Panel, PanelEmpty } from './components/panel'
import { DirectorySkeleton, ViewerSkeleton } from './components/skeleton'
import { DirectoryPage } from './pages/directory'
import { ViewerPage } from './pages/viewer'
import { MetadataPage } from './pages/metadata'

type FileInfo = {
  name: string
  type: string
  size: number
  hash: string
  updatedAt: number
  downloadEnabled: boolean
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    function onPopState() {
      setPath(window.location.pathname)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  return path
}

function App() {
  const path = usePath()
  const searchParams = new URLSearchParams(window.location.search)
  const viewMode = searchParams.get('view')

  const { data, isLoading } = useSWR(path, fetchPath, { keepPreviousData: true })

  const [metadata, setMetadata] = useState<ShareMetadata | null>(null)
  const [showMetadata, setShowMetadata] = useState(viewMode === 'metadata')

  useEffect(() => {
    const isMetaView = viewMode === 'metadata'
    setShowMetadata(isMetaView)
    if (isMetaView) {
      fetchMetadata(path).then(setMetadata)
    }
  }, [path, viewMode])

  const toggleMetadata = useCallback(async () => {
    if (showMetadata) {
      window.history.pushState(null, '', path)
      setShowMetadata(false)
    } else {
      const meta = metadata ?? (await fetchMetadata(path))
      setMetadata(meta)
      window.history.pushState(null, '', `${path}?view=metadata`)
      setShowMetadata(true)
    }
  }, [path, showMetadata, metadata])

  // Determine view type from data
  const isDirectory = data?.type === 'directory'
  const isFile = data?.type === 'file'
  const isError = data?.type === 'error'
  const fileInfo = isFile ? (data.data as FileInfo) : null
  const dirData = isDirectory ? (data.data as DirectoryResponse) : null

  // Actions for file viewer
  const downloadEnabled = fileInfo?.downloadEnabled ?? false
  const fileActions = isFile ? (
    <div className="flex gap-2">
      {downloadEnabled && (
        <a
          href={`${path}?dl`}
          title="Download"
          className="flex items-center px-2.5 py-1.5 border border-gray-200 rounded text-gray-500 hover:border-blue-600 hover:text-blue-600 transition-colors text-sm no-underline"
        >
          <DownloadIcon />
        </a>
      )}
      <button
        onClick={toggleMetadata}
        title={showMetadata ? 'View file' : 'View metadata'}
        className="flex items-center px-2.5 py-1.5 border border-gray-200 rounded text-gray-500 hover:border-blue-600 hover:text-blue-600 transition-colors text-sm cursor-pointer"
      >
        {showMetadata ? <FileIcon /> : <BracesIcon />}
      </button>
    </div>
  ) : null

  return (
    <div className="max-w-[900px] mx-auto px-5 py-10">
      <div className="flex items-center justify-between mb-4">
        <Breadcrumbs path={path} />
        {fileActions}
      </div>

      {isLoading && !data ? (
        isFile || path.includes('.') ? (
          <ViewerSkeleton />
        ) : (
          <DirectorySkeleton />
        )
      ) : isError ? (
        <Panel>
          <PanelEmpty>{data.message}</PanelEmpty>
        </Panel>
      ) : isFile && fileInfo ? (
        showMetadata && metadata ? (
          <MetadataPage path={path} metadata={metadata} />
        ) : (
          <ViewerPage path={path} file={fileInfo} downloadEnabled={downloadEnabled} />
        )
      ) : dirData ? (
        <DirectoryPage path={path} data={dirData} />
      ) : (
        <DirectorySkeleton />
      )}

      <Footer />
    </div>
  )
}

function Footer() {
  return (
    <footer className="mt-10 text-gray-300 text-sm">
      Powered by the{' '}
      <a
        href="https://github.com/SiaFoundation/sia-storage-app"
        className="text-gray-300 hover:text-gray-500 no-underline hover:underline"
      >
        Sia Storage CLI
      </a>
    </footer>
  )
}

function DownloadIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7Z" />
      <path d="M14 2v4a2 2 0 002 2h4" />
    </svg>
  )
}

function BracesIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3H7a2 2 0 00-2 2v5a2 2 0 01-2 2 2 2 0 012 2v5c0 1.1.9 2 2 2h1" />
      <path d="M16 21h1a2 2 0 002-2v-5c0-1.1.9-2 2-2a2 2 0 01-2-2V5a2 2 0 00-2-2h-1" />
    </svg>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
