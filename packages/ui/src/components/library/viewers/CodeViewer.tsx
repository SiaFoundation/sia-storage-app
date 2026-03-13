import { useEffect, useState } from 'react'

export function CodeViewer({
  url,
  mimeType,
  name,
}: {
  url: string
  mimeType: string
  name: string
}) {
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    fetch(url)
      .then((r) => r.text())
      .then((raw) => {
        if (mimeType === 'application/json' || name.endsWith('.json')) {
          try {
            return JSON.stringify(JSON.parse(raw), null, 2)
          } catch {
            return raw
          }
        }
        return raw
      })
      .then(setText)
      .catch(() => setText('Failed to load content'))
  }, [url, mimeType, name])

  if (!text) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-neutral-600 border-t-green-500 rounded-full animate-spin" />
      </div>
    )
  }

  const lines = text.split('\n')

  return (
    <div className="flex-1 overflow-auto p-4">
      <pre className="w-full bg-neutral-900 rounded-lg p-4 text-sm text-neutral-300 font-mono overflow-x-auto">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span className="text-neutral-600 select-none w-12 text-right pr-4 shrink-0">
              {i + 1}
            </span>
            <span className="whitespace-pre">{line}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}
