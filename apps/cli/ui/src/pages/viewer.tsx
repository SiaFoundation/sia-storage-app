import { Download, FileText } from 'lucide-react'
import { useState, useEffect } from 'react'
import { formatBytes, formatRelativeDate } from '../lib/format'
import { Panel, PanelHeader, PanelBody, PanelEmpty } from '../components/panel'

type FileInfo = {
  name: string
  type: string
  size: number
  updatedAt?: number
  downloadEnabled?: boolean
}

type ViewerPageProps = {
  path: string
  file: FileInfo
  downloadEnabled: boolean
}

function canPreview(type: string): boolean {
  return (
    type.startsWith('image/') ||
    type.startsWith('video/') ||
    type.startsWith('audio/') ||
    type === 'application/pdf' ||
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/javascript'
  )
}

function isTextType(type: string): boolean {
  return (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/javascript'
  )
}

function TextPreview({ rawUrl }: { rawUrl: string }) {
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    fetch(rawUrl)
      .then((r) => r.text())
      .then(setContent)
      .catch(() => setContent('Failed to load content'))
  }, [rawUrl])

  if (content === null) {
    return (
      <div className="p-4">
        <div className="h-4 bg-gray-100 rounded animate-pulse w-3/4 mb-2" />
        <div className="h-4 bg-gray-100 rounded animate-pulse w-1/2" />
      </div>
    )
  }

  return (
    <div className="p-4">
      <pre className="text-sm leading-relaxed whitespace-pre-wrap break-words font-mono text-gray-700 max-h-[70vh] overflow-auto">
        {content}
      </pre>
    </div>
  )
}

function Preview({ type, rawUrl }: { type: string; rawUrl: string }) {
  if (type.startsWith('image/')) {
    return (
      <div className="p-4 text-center">
        <img src={rawUrl} alt="preview" className="max-w-full max-h-[70vh] rounded inline-block" />
      </div>
    )
  }
  if (type.startsWith('video/')) {
    return (
      <div className="p-4 text-center">
        <video controls src={rawUrl} className="max-w-full" />
      </div>
    )
  }
  if (type.startsWith('audio/')) {
    return (
      <div className="p-4 text-center">
        <audio controls src={rawUrl} className="w-full" />
      </div>
    )
  }
  if (type === 'application/pdf') {
    return (
      <div className="p-4">
        <iframe src={rawUrl} className="w-full h-[70vh] border-none bg-white rounded" />
      </div>
    )
  }
  if (isTextType(type)) {
    return <TextPreview rawUrl={rawUrl} />
  }
  return null
}

export function ViewerPage({ path, file, downloadEnabled }: ViewerPageProps) {
  const typeBadge = file.type.split('/')[1] ?? file.type
  const href = path.startsWith('/') ? path : `/${path}`

  const headerInfo = (
    <div className="flex gap-1 items-center font-mono">
      <span>{typeBadge}</span>
      <span className="text-gray-300">&middot;</span>
      <span>{formatBytes(file.size)}</span>
      {file.updatedAt ? (
        <>
          <span className="text-gray-300">&middot;</span>
          <span>{formatRelativeDate(file.updatedAt)}</span>
        </>
      ) : null}
    </div>
  )

  if (!downloadEnabled) {
    return (
      <Panel>
        <PanelHeader>{headerInfo}</PanelHeader>
        <PanelEmpty>
          <FileText size={48} className="mx-auto mb-4 text-gray-300" />
          <p>File not available for direct download.</p>
          <p className="mt-3">
            <a href={`${href}?view=metadata`} className="text-blue-600 hover:underline">
              View metadata
            </a>
          </p>
        </PanelEmpty>
      </Panel>
    )
  }

  const showPreview = canPreview(file.type)

  return (
    <Panel>
      <PanelHeader>{headerInfo}</PanelHeader>
      {showPreview ? (
        <PanelBody>
          <Preview type={file.type} rawUrl={`${href}?raw`} />
        </PanelBody>
      ) : (
        <PanelEmpty>
          <Download size={48} className="mx-auto mb-4 text-gray-300" />
          <a
            href={`${href}?dl`}
            className="inline-block px-6 py-2.5 border border-gray-200 rounded text-blue-600 hover:border-blue-600 no-underline"
          >
            Download file
          </a>
        </PanelEmpty>
      )}
    </Panel>
  )
}
