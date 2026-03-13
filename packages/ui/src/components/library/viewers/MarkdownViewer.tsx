import { useEffect, useState } from 'react'

export function MarkdownViewer({ url }: { url: string }) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    fetch(url)
      .then((r) => r.text())
      .then((md) => setHtml(renderMarkdown(md)))
      .catch(() => setHtml('<p>Failed to load content</p>'))
  }, [url])

  if (!html) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-neutral-600 border-t-green-500 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <div
        className="max-w-3xl mx-auto bg-neutral-900 rounded-lg p-8 prose prose-invert prose-sm prose-headings:text-neutral-200 prose-p:text-neutral-300 prose-a:text-green-400 prose-code:text-green-300 prose-pre:bg-neutral-800 prose-pre:text-neutral-300"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: rendering user markdown
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

function renderMarkdown(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  )

  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, (match) => `<ul>${match}</ul>`)
  html = html.replace(/<\/ul>\s*<ul>/g, '')

  html = html.replace(/^(?!<[huplo])(.*\S.*)$/gm, '<p>$1</p>')
  html = html.replace(/<p><\/p>/g, '')

  return html
}
