import { Download, Braces, File, Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'

type NavActionsProps = {
  downloadHref?: string
  metadataHref?: string
  fileHref?: string
  rawHref?: string
  onCopy?: () => void
}

function ActionButton({
  href,
  onClick,
  title,
  children,
}: {
  href?: string
  onClick?: () => void
  title: string
  children: React.ReactNode
}) {
  const className =
    'flex items-center gap-1 px-2.5 py-1.5 border border-gray-200 rounded text-gray-500 hover:border-blue-600 hover:text-blue-600 transition-colors text-sm no-underline'
  if (href) {
    return (
      <a href={href} title={title} className={className}>
        {children}
      </a>
    )
  }
  return (
    <button onClick={onClick} title={title} className={className}>
      {children}
    </button>
  )
}

export function NavActions({
  downloadHref,
  metadataHref,
  fileHref,
  rawHref,
  onCopy,
}: NavActionsProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    onCopy?.()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex gap-2">
      {downloadHref && (
        <ActionButton href={downloadHref} title="Download">
          <Download size={16} />
        </ActionButton>
      )}
      {metadataHref && (
        <ActionButton href={metadataHref} title="View metadata">
          <Braces size={16} />
        </ActionButton>
      )}
      {fileHref && (
        <ActionButton href={fileHref} title="View file">
          <File size={16} />
        </ActionButton>
      )}
      {rawHref && (
        <ActionButton href={rawHref} title="View raw">
          <ExternalLink size={16} />
        </ActionButton>
      )}
      {onCopy && (
        <ActionButton onClick={handleCopy} title="Copy to clipboard">
          <Copy size={16} />
          {copied && <span className="text-xs">Copied</span>}
        </ActionButton>
      )}
    </div>
  )
}
