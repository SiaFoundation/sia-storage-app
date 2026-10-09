/**
 * Lets a simulation test drive this app. The app connects out to the mock
 * network's relay over a WebSocket and answers each call, since a test cannot
 * connect into a simulator. Calls are AppService methods named by their dotted
 * path, such as `files.renameFile`, the same surface the CLI daemon serves,
 * plus a few `sim.*` steps that stand in for screens a test would otherwise
 * tap through.
 *
 * iOS freezes the app in the background without closing the socket, so the
 * app reports each move between foreground and background, and the relay
 * fails a call to a backgrounded app at once. A closed socket reconnects every
 * second.
 */
import type { DownloadPriority } from '@siastorage/core/app'
import { logger } from '@siastorage/logger'
import * as MediaLibrary from 'expo-media-library'
import { Keyboard } from 'react-native'
import { database, db, getDbState } from '../db'
import { importFiles } from '../lib/importFiles'
import {
  ensureMediaLibraryPermission,
  getMediaLibraryPermissions,
} from '../lib/mediaLibraryPermissions'
import { initApp } from '../managers/app'
import { run as syncNewPhotos, setAutoSyncNewPhotos } from '../managers/syncNewPhotos'
import { startArchiveSync } from '../managers/syncPhotosArchive'
import { addLifecycleListener, getLifecycle } from '../managers/lifecycle'
import { simHooks } from '../lib/simHooks'
import { app } from '../stores/appService'
import { authenticateIndexer, registerWithIndexer } from '../stores/sdk'
import { MOCK_PHRASE } from '@siastorage/mock-network/protocol'

type Call = { id: string; method: string; args: unknown[] }

let releaseImportCopies = () => {}

/** How each download `sim.startDownload` started has ended so far, by the number it returned. */
const startedDownloads: Array<{ settled: boolean; error?: string }> = []

const simSteps: Record<string, (...args: never[]) => Promise<unknown>> = {
  /** Where the app is: signed in or not, and whether startup has finished. */
  async 'sim.status'() {
    return {
      hasOnboarded: await app().settings.getHasOnboarded(),
      isInitializing: app().init.getState().isInitializing,
      isConnected: app().connection.getState().isConnected,
    }
  },

  /**
   * Signs in through the same store functions the onboarding screens call,
   * then finishes onboarding the way they do.
   */
  async 'sim.signIn'(indexerURL: string) {
    const [, authErr] = await authenticateIndexer(indexerURL)
    if (authErr) throw new Error(`authenticate failed: ${JSON.stringify(authErr)}`)
    const [, regErr] = await registerWithIndexer(MOCK_PHRASE, indexerURL)
    if (regErr) throw new Error(`register failed: ${JSON.stringify(regErr)}`)
    app().init.setState({ isInitializing: true })
    await app().settings.setHasOnboarded(true)
    await initApp()
    return null
  },

  /**
   * Writes a copy of the database to `path` with VACUUM INTO, which reads
   * every committed write, the WAL's included, for a test to read while the
   * app keeps writing.
   */
  async 'sim.copyDatabase'(path: string) {
    await database.execAsync(`VACUUM INTO '${path.replace(/'/g, "''")}'`)
    return null
  },

  /**
   * Adds files by path through the function the file picker calls, which
   * starts the import scanner at once rather than on its next interval.
   */
  async 'sim.importFiles'(paths: string[], directoryId: string | null = null) {
    const assets = paths.map((path) => ({
      id: undefined,
      sourceUri: path.startsWith('file://') ? path : `file://${path}`,
      type: undefined,
      name: path.split('/').pop(),
      timestamp: undefined,
    }))
    return importFiles(assets, 'file', { destinationDirectoryId: directoryId })
  },

  /** Holds every import copy after its bytes land, until released. */
  async 'sim.holdImportCopies'() {
    if (simHooks.importCopyHold) return
    let release = () => {}
    simHooks.importCopyHold = new Promise<void>((resolve) => {
      release = resolve
    })
    releaseImportCopies = release
  },
  /**
   * Lets every held import copy publish, and stops holding new ones. Resolves
   * to whether a hold was still in place, which after
   * `sim.holdImportCopiesUntilSuspend` means no suspension released it.
   */
  async 'sim.releaseImportCopies'() {
    const held = simHooks.importCopyHold !== null
    simHooks.importCopyHold = null
    releaseImportCopies()
    releaseImportCopies = () => {}
    return held
  },
  /**
   * Holds import copies as `sim.holdImportCopies` does, and releases them on
   * its own once a suspension has closed the database gate, so the import's
   * next write lands on a closed gate. An app frozen in the background cannot
   * be told to release them, which is why the release is not a call.
   */
  async 'sim.holdImportCopiesUntilSuspend'() {
    if (simHooks.importCopyHold) return
    simHooks.importCopyHold = new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (getDbState() === 'active') return
        clearInterval(poll)
        simHooks.importCopyHold = null
        resolve()
      }, 5)
      releaseImportCopies = () => {
        clearInterval(poll)
        resolve()
      }
    })
  },
  /** Makes the next import copy end as cancelled, as a native copy can without a suspension. */
  async 'sim.cancelNextImportCopy'() {
    simHooks.cancelNextImportCopy = true
  },
  /**
   * Starts a statement that keeps SQLite busy for several seconds, then runs
   * the app's setup again as signing in does, and resolves once that setup
   * returns. The statement goes through the database adapter, as the first
   * setup's log rotation and migrations do, and is not awaited.
   */
  async 'sim.reinitializeDuringStatement'() {
    db()
      .getFirstAsync(
        'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c LIMIT 20000000) SELECT count(*) AS n FROM c',
      )
      .catch(() => {})
    // Long enough for the statement to reach SQLite before setup closes the connection.
    await new Promise((resolve) => setTimeout(resolve, 100))
    await initApp()
    return null
  },
  /** Whether the app can read the photo library. */
  async 'sim.photoAccess'() {
    return getMediaLibraryPermissions()
  },

  /**
   * Asks for photo library access as the settings do, which shows the system
   * prompt when access is undecided. Resolves once the prompt is answered.
   */
  async 'sim.requestPhotoAccess'() {
    return ensureMediaLibraryPermission()
  },

  /**
   * Turns on importing new photos the way the settings toggle does, which
   * also marks the library's current contents as already seen, so only
   * photos added afterwards are imported.
   */
  async 'sim.enableNewPhotoSync'() {
    await setAutoSyncNewPhotos(true)
    return null
  },

  /** Runs one pass of new-photo import now rather than on its 10 second timer. */
  async 'sim.syncNewPhotosNow'() {
    await syncNewPhotos()
    return null
  },

  /**
   * Whether React Native has been told the keyboard is open. A scroll view
   * swallows a tap to close the keyboard only when it has, and the
   * accessibility tree can show a keyboard React Native never heard about.
   */
  async 'sim.keyboard'() {
    return { visible: Keyboard.isVisible(), height: Keyboard.metrics()?.height ?? null }
  },

  /**
   * Starts a download as `downloads.downloadFile` does and returns once the
   * app has registered it, or joined it to the download already running for
   * that file, without waiting for it to end. Each call from sim reaches the
   * app on its own request, so two calls sent in a row can arrive in either
   * order, and a scenario that orders downloads waits for each to return.
   */
  async 'sim.startDownload'(fileId: string, priority: DownloadPriority) {
    const outcome: { settled: boolean; error?: string } = { settled: false }
    startedDownloads.push(outcome)
    app()
      .downloads.downloadFile(fileId, priority)
      .then(
        () => {
          outcome.settled = true
        },
        (e: unknown) => {
          outcome.settled = true
          outcome.error = e instanceof Error ? e.message : String(e)
        },
      )
    return startedDownloads.length - 1
  },

  /** Whether a download `sim.startDownload` started has ended, and its error if it failed. */
  async 'sim.downloadOutcome'(started: number) {
    return startedDownloads[started] ?? null
  },

  /** How many photos and videos the app's own library query sees. */
  async 'sim.photoLibraryCount'() {
    const page = await MediaLibrary.getAssetsAsync({
      first: 1,
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
    })
    return page.totalCount
  },

  /** Starts importing the whole photo library, as the Import photo library sheet does. */
  async 'sim.startArchiveSync'() {
    await startArchiveSync()
    return null
  },
}

async function dispatch(method: string, args: unknown[]): Promise<unknown> {
  const step = simSteps[method]
  if (step) return step(...(args as never[]))
  // A method can sit under nested namespaces, such as `auth.builder.create`.
  const path = method.split('.')
  let target: unknown = app()
  for (const key of path.slice(0, -1))
    target = (target as Record<string, unknown> | undefined)?.[key]
  const fn = (target as Record<string, unknown> | undefined)?.[path[path.length - 1]]
  if (typeof fn !== 'function') throw new Error(`No method ${method}`)
  return (fn as (...a: unknown[]) => unknown).apply(target, args)
}

export function startRemoteControl(network: { url: string; device: string }): void {
  // For a scenario that needs the keyboard up, the log shows whether React
  // Native heard it open and close, which the accessibility tree cannot.
  for (const event of [
    'keyboardWillShow',
    'keyboardDidShow',
    'keyboardWillHide',
    'keyboardDidHide',
  ] as const) {
    Keyboard.addListener(event, (e) =>
      logger.debug('sim', event, { height: e?.endCoordinates?.height ?? null }),
    )
  }
  const url = `${network.url.replace(/^http/, 'ws')}/relay/${encodeURIComponent(network.device)}`
  let socket: WebSocket | null = null
  addLifecycleListener((next) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ lifecycle: next }))
  })
  const connect = () => {
    const ws = new WebSocket(url)
    socket = ws
    // A socket that closed while a call ran has nobody to answer, and sending
    // on it throws. The relay has already failed the call.
    const answer = (message: object) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
    }
    ws.onmessage = (event) => {
      const call = JSON.parse(String(event.data)) as Call
      // answer throws on a result JSON.stringify cannot encode, such as a
      // BigInt or a cycle. The catch reports that as the call's error, or the
      // caller would wait out the relay's timeout for an answer never sent.
      dispatch(call.method, call.args)
        .then((result) => answer({ id: call.id, ok: true, result }))
        .catch((e: unknown) =>
          answer({ id: call.id, ok: false, error: e instanceof Error ? e.message : String(e) }),
        )
    }
    // A socket that reconnects while the app is in the background, such as
    // one iOS closed while the app was suspended, would otherwise be taken
    // as in the foreground.
    ws.onopen = () => answer({ lifecycle: getLifecycle() })
    ws.onclose = () => setTimeout(connect, 1000)
    ws.onerror = () => {
      logger.debug('sim', 'relay_error', { url })
    }
  }
  connect()
}
