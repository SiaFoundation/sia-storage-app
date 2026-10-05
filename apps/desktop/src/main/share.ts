/*
 * Share requests from Finder, on their way to the window.
 *
 * The request arrives on the daemon stream and is held here until the window
 * takes it. Pushing the files to the window instead would lose them whenever
 * the window is opened for the request, because its page is still loading
 * when the message is sent.
 */

import { broadcast, hidePopover, showMainWindow } from './windows'

let pending: string[] | null = null

export function receiveShareRequest(fileIds: string[]): void {
  pending = fileIds
  hidePopover()
  showMainWindow()
  broadcast('share:requested', null)
}

/** The files of the request waiting, once. Null when none is. */
export function takeShareRequest(): string[] | null {
  const fileIds = pending
  pending = null
  return fileIds
}
