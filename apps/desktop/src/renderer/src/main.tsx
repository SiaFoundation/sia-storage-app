/*
 * One bundle serves both windows. Which one this is comes from the URL hash the
 * main process loads it with: `#popover` or `#main`.
 *
 * The popover carries the status view. The window is a placeholder until the
 * library lands in it.
 */

import { AppProvider } from '@siastorage/core/app'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createWindowService } from './service'
import { Status } from './Status'
import './styles.css'

const isPopover = window.location.hash === '#popover'
document.body.className = isPopover ? 'popover' : 'window'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <AppProvider value={createWindowService()}>
      {isPopover ? <Status /> : <p className="placeholder">Sia Storage</p>}
    </AppProvider>
  </StrictMode>,
)
