/*
 * Both windows open at a guessed height and then resize to what the renderer
 * reports. Attach the returned ref to the element whose height the window
 * should take.
 *
 * Observed rather than measured once, because rows and views come and go with
 * state and a stale measurement leaves the window with a gap under its content.
 */

import { useEffect, useRef } from 'react'
import { sia } from './api'

export function useReportedHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const report = () => sia.reportHeight(element.getBoundingClientRect().height)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return ref
}
