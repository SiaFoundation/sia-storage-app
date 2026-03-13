import { useEffect, useRef, useState } from 'react'
import { detectMimeType } from '../../../lib/detectMimeType'

type ViewState =
  | { status: 'native'; url: string }
  | { status: 'converting' }
  | { status: 'converted'; url: string }
  | { status: 'failed' }

export function ImageViewer({
  url,
  name,
  fileData,
  onRetry,
}: {
  url: string
  name: string
  mimeType?: string
  fileData?: ArrayBuffer | null
  onRetry?: () => void
}) {
  const [state, setState] = useState<ViewState>({ status: 'native', url })
  const convertedUrlRef = useRef<string | null>(null)

  useEffect(() => {
    setState({ status: 'native', url })
  }, [url])

  useEffect(() => {
    return () => {
      if (convertedUrlRef.current) {
        URL.revokeObjectURL(convertedUrlRef.current)
      }
    }
  }, [])

  async function handleNativeError() {
    if (!fileData) {
      setState({ status: 'failed' })
      return
    }

    const detected = detectMimeType(fileData)
    const isHeic = detected === 'image/heic' || detected === 'image/heif'

    if (!isHeic) {
      setState({ status: 'failed' })
      return
    }

    setState({ status: 'converting' })
    try {
      const { heicTo } = await import('heic-to')
      const blob = await heicTo({
        blob: new Blob([fileData], { type: detected }),
        type: 'image/jpeg',
        quality: 0.92,
      })
      const convertedUrl = URL.createObjectURL(blob)
      if (convertedUrlRef.current) {
        URL.revokeObjectURL(convertedUrlRef.current)
      }
      convertedUrlRef.current = convertedUrl
      setState({ status: 'converted', url: convertedUrl })
    } catch {
      setState({ status: 'failed' })
    }
  }

  if (state.status === 'converting') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
        <div className="w-6 h-6 border-2 border-neutral-600 border-t-neutral-300 rounded-full animate-spin" />
        <p className="text-neutral-500 text-sm">Converting HEIC...</p>
      </div>
    )
  }

  if (state.status === 'failed') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
        <p className="text-neutral-400 text-sm">Unable to display image</p>
        {onRetry && (
          <button
            type="button"
            onClick={() => {
              setState({ status: 'native', url })
              onRetry()
            }}
            className="px-4 py-2 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors"
          >
            Try again
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
      <img
        src={state.url}
        alt={name}
        className="max-w-full max-h-full object-contain"
        onError={() => handleNativeError()}
      />
    </div>
  )
}
