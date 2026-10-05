/*
 * The actions under the status, shared by the popover and the window.
 *
 * Labelled buttons on the left for the two places there are to go, the Finder
 * folder and the window. The glyph buttons on the right act on the app itself.
 */

import { sia } from './api'
import { AppWindow, Ellipsis, Folder, Power } from './icons'
import type { Status } from './model'

const BUTTON =
  'flex cursor-default items-center gap-[5px] rounded-[5px] border-none bg-transparent py-[5px] text-[12px] text-label outline-none [font-family:inherit] ' +
  'transition-[scale,background-color] duration-150 ease-settle enabled:active:scale-[0.96] ' +
  // Keyboard focus still needs to be visible. A mouse click should not ring.
  'enabled:hover:bg-card focus-visible:shadow-[0_0_0_2px_var(--color-accent)] disabled:text-secondary disabled:opacity-50'

export function Footer({
  status,
  surface,
  version,
}: {
  status: Status
  surface: 'popover' | 'window'
  /** Shown in the window, which has the width for it. */
  version?: string
}) {
  return (
    <footer className="mt-auto flex items-center gap-0.5 border-t border-divider px-2.5 pt-[9px] pb-2">
      <button
        type="button"
        className={`${BUTTON} px-2`}
        onClick={() => void sia.openMount()}
        disabled={!status.mountPath}
      >
        <Folder />
        Open Folder
      </button>
      {surface === 'popover' ? (
        <button type="button" className={`${BUTTON} px-2`} onClick={() => void sia.openWindow()}>
          <AppWindow />
          Open App
        </button>
      ) : null}
      {/* Everything from here is pushed right, away from the buttons that are
          safe to click by accident. */}
      <span className="ml-auto pr-1.5 text-[11px] text-secondary tabular-nums select-text">
        {surface === 'window' && version ? `Version ${version}` : null}
      </span>
      {/* Square, because the glyph is the whole label. */}
      <button
        type="button"
        className={`${BUTTON} px-1.5`}
        aria-label="More"
        title="More"
        onClick={() => void sia.showMoreMenu()}
      >
        <Ellipsis />
      </button>
      <button
        type="button"
        className={`${BUTTON} px-1.5`}
        aria-label="Quit"
        title="Quit Sia Storage"
        onClick={() => void sia.quit()}
      >
        <Power />
      </button>
    </footer>
  )
}
