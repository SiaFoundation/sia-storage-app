/*
 * Share requests from Finder.
 *
 * Finder's Share Link action runs in the File Provider extension, which is
 * sandboxed and cannot show a window, and a link's expiry has to be picked
 * before the link exists. So the extension hands the selected files to the
 * daemon, and the daemon hands them to the desktop app, which asks. The daemon
 * is the one process both can reach.
 *
 * The request is pushed to every app attached to the CLI socket's change
 * stream, which only the desktop app subscribes to. With none attached, the
 * daemon opens the app named by SIA_DESKTOP_APP, which the desktop app sets
 * when it starts the daemon, and holds the request for PENDING_MS so the app
 * gets it once it attaches. A daemon the CLI started has no app to open.
 */
import { spawn } from 'node:child_process'
import { logger } from '@siastorage/logger'

export type ShareRequestFrame = { event: 'share'; fileIds: string[] }

/** Long enough for the app to launch, sign its daemon client in and subscribe. */
const PENDING_MS = 60_000

export type ShareRequests = {
  /**
   * Sends the request to the app, opening it first if none is attached.
   * Rejects when the app cannot be opened, with a message that names no path,
   * since Finder shows it as is.
   */
  request(fileIds: string[]): Promise<void>
  /** An app attached to the change stream. It gets a request still waiting, once. */
  attached(push: (frame: ShareRequestFrame) => void): void
}

export function createShareRequests(opts: {
  /** How many apps hold the change stream open. */
  subscriberCount: () => number
  broadcast: (frame: ShareRequestFrame) => void
  /** The desktop app's bundle, or undefined for a daemon the CLI started. */
  appPath?: string
  /** Resolves once the app has been launched, and rejects when it could not be. */
  openApp?: (appPath: string) => Promise<void>
}): ShareRequests {
  const openApp =
    opts.openApp ??
    ((appPath: string) =>
      // `open` exits once LaunchServices has launched the app, and exits
      // nonzero when the bundle is gone, such as one moved while its daemon
      // kept running. A spawn error alone would miss that case.
      new Promise<void>((resolve, reject) => {
        const child = spawn('/usr/bin/open', [appPath], { stdio: 'ignore' })
        child.on('error', reject)
        child.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`open exited with ${code}`)),
        )
      }))
  let pending: { frame: ShareRequestFrame; at: number } | null = null

  return {
    async request(fileIds) {
      const frame: ShareRequestFrame = { event: 'share', fileIds }
      if (opts.subscriberCount() > 0) {
        opts.broadcast(frame)
        return
      }
      if (!opts.appPath) {
        throw new Error('Open Sia Storage to share files from Finder.')
      }
      pending = { frame, at: Date.now() }
      try {
        await openApp(opts.appPath)
      } catch (error) {
        if (pending?.frame === frame) pending = null
        logger.warn('share', 'open_app_failed', { appPath: opts.appPath, error: error as Error })
        throw new Error('Sia Storage could not be opened. Open it, then share again.')
      }
    },
    attached(push) {
      if (pending && Date.now() - pending.at < PENDING_MS) push(pending.frame)
      pending = null
    },
  }
}
