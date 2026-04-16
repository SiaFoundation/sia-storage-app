import type { AnchorHTMLAttributes, MouseEvent } from 'react'

const SERVER_PARAMS = ['dl', 'raw', 'share']

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement>

export function Link({ href, onClick, children, ...props }: LinkProps) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (!href || href.startsWith('http')) return

    // Let server handle ?dl, ?raw, ?share
    if (href.includes('?')) {
      const params = new URLSearchParams(href.split('?')[1])
      if (SERVER_PARAMS.some((p) => params.has(p))) return
    }

    e.preventDefault()
    window.history.pushState(null, '', href)
    window.dispatchEvent(new PopStateEvent('popstate'))
    onClick?.(e)
  }

  return (
    <a href={href} onClick={handleClick} {...props}>
      {children}
    </a>
  )
}
