/*
 * A scroll area whose scroll bar floats over the content the way an AppKit
 * overlay scroller does: a thin thumb with no track, shown while the content
 * moves and for a second after, and when the area first appears.
 *
 * Chromium's own bar is hidden rather than styled. Any ::-webkit-scrollbar
 * rule switches Chromium to the always-shown kind that takes its width from
 * the content, and the bar it draws unstyled runs into a rounded card's
 * corners, since CSS cannot inset a native scroll bar.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Space between the thumb and the area's top and bottom edges, clear of a card's rounded corners. */
const END_INSET = 4
const MIN_THUMB = 24
const HIDE_AFTER_MS = 1_000

type Thumb = { top: number; height: number }

export function ScrollArea({
  className,
  children,
  testId,
}: {
  className?: string
  children: React.ReactNode
  testId?: string
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const drag = useRef<{ pointerY: number; scrollTop: number } | null>(null)
  const [thumb, setThumb] = useState<Thumb | null>(null)
  const [shown, setShown] = useState(true)

  const measure = useCallback(() => {
    const el = viewport.current
    if (!el) return
    const { scrollHeight, clientHeight, scrollTop } = el
    if (scrollHeight <= clientHeight) {
      setThumb(null)
      return
    }
    const track = clientHeight - 2 * END_INSET
    const height = Math.max(MIN_THUMB, (track * clientHeight) / scrollHeight)
    const top = END_INSET + ((track - height) * scrollTop) / (scrollHeight - clientHeight)
    setThumb({ top, height })
  }, [])

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!drag.current) setShown(false)
    }, HIDE_AFTER_MS)
  }, [])

  const show = useCallback(() => {
    setShown(true)
    scheduleHide()
  }, [scheduleHide])

  useLayoutEffect(() => {
    measure()
    // The viewport changes size with the window and the content with its
    // rows, and neither fires a scroll event.
    const observer = new ResizeObserver(measure)
    if (viewport.current) observer.observe(viewport.current)
    if (content.current) observer.observe(content.current)
    return () => observer.disconnect()
  }, [measure])

  // Shown from the first render and hidden a second later: AppKit flashes a
  // scroll view's scrollers when it appears, so a list that scrolls says so
  // before anyone tries.
  useEffect(() => {
    scheduleHide()
    return () => clearTimeout(hideTimer.current)
  }, [scheduleHide])

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = viewport.current
    if (!el) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { pointerY: e.clientY, scrollTop: el.scrollTop }
    show()
  }

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = viewport.current
    if (!el || !drag.current || !thumb) return
    const track = el.clientHeight - 2 * END_INSET
    const perPixel = (el.scrollHeight - el.clientHeight) / Math.max(1, track - thumb.height)
    el.scrollTop = drag.current.scrollTop + (e.clientY - drag.current.pointerY) * perPixel
  }

  const endDrag = () => {
    drag.current = null
    show()
  }

  return (
    <div className="relative">
      <div
        ref={viewport}
        className={`${className ?? ''} [scrollbar-width:none]`}
        data-testid={testId}
        onScroll={() => {
          measure()
          show()
        }}
      >
        <div ref={content}>{children}</div>
      </div>
      {thumb ? (
        <div
          aria-hidden
          className={`group/thumb absolute right-0 flex w-[13px] justify-center transition-opacity duration-300 ${
            shown ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={{ top: thumb.top, height: thumb.height }}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="h-full w-[6px] rounded-full bg-[color-mix(in_srgb,var(--label)_38%,transparent)] transition-[width,background-color] duration-150 group-hover/thumb:w-[8px] group-hover/thumb:bg-[color-mix(in_srgb,var(--label)_55%,transparent)]" />
        </div>
      ) : null}
    </div>
  )
}
