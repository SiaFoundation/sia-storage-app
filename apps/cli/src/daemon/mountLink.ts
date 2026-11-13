/*
 * The mount adapter for an integration that stays connected to the daemon.
 *
 * The daemon asks the operating system three things about the mount, the
 * folder a file manager shows: remove your copy of these files, hand these
 * files' bytes back, and which files do you hold whole. On macOS only a
 * program inside the app can ask, so the daemon runs one per call
 * (`finderAgent.ts`). Where the integration is a program of ours that runs
 * for as long as the mount is up, such as a Windows sync root provider, it
 * can ask the system itself, and this file carries the question to it.
 *
 * The integration calls `mount` on a connection and keeps it open. Each
 * question goes down that connection as a frame, and the integration answers
 * with a `mountAnswer` call naming the frame's request id. When the system
 * writes or removes a file, the integration calls `provider.mountChanged`, as
 * the macOS extension does, and the daemon's next read asks for the list.
 * The daemon raises the same hint itself when a link attaches, since the
 * folder can have changed while nothing was connected.
 */
import type { Mount, MountAdapter } from '@siastorage/core/adapters'
import type { IpcConnection } from '@siastorage/node-adapters'
import type { MountRequestFrame } from '@siastorage/node-adapters/mountLink'

/**
 * Removing a copy is a local file operation, so a full call ends far inside
 * this. A timeout loses every answer in the call.
 */
const REQUEST_TIMEOUT_MS = 60_000

export type MountLink = {
  /**
   * Asks over the link. While no integration holds the link open, a request
   * to act on files rejects, and a read of the mount's files resolves null.
   */
  adapter: MountAdapter
  /** Makes `connection` the link. */
  attach(connection: IpcConnection): void
  /** Takes the integration's answer to one request, a result per stack id. */
  answer(request: string, results: unknown): void
}

export function createMountLink(opts: { timeoutMs?: number } = {}): MountLink {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS
  let link: IpcConnection | null = null
  const waiting = new Map<string, { resolve(results: unknown): void; reject(e: Error): void }>()

  function failAll(reason: string): void {
    for (const [, request] of waiting) request.reject(new Error(reason))
    waiting.clear()
  }

  /**
   * Sends one question and resolves with the integration's answer as it sent
   * it. The core reads a result it does not know as the file being kept.
   */
  async function ask<T>(
    verb: MountRequestFrame['verb'],
    stackIds: string[],
    signal?: AbortSignal,
  ): Promise<T> {
    if (!link) throw new Error('No integration is connected to ask about the mount')
    if (signal?.aborted) throw new Error(`The ${verb} was aborted`)
    const request = crypto.randomUUID()
    const answered = new Promise<unknown>((resolve, reject) => {
      waiting.set(request, { resolve, reject })
    })
    const timer = setTimeout(() => {
      waiting.get(request)?.reject(new Error(`The integration did not answer a ${verb} in time`))
    }, timeoutMs)
    const abort = () => waiting.get(request)?.reject(new Error(`The ${verb} was aborted`))
    signal?.addEventListener('abort', abort, { once: true })
    try {
      link.push({ event: 'mount', request, verb, stackIds } satisfies MountRequestFrame)
      const results = await answered
      if (results === null || typeof results !== 'object') {
        throw new Error(`The integration answered a ${verb} with no results`)
      }
      return results as T
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      waiting.delete(request)
    }
  }

  return {
    adapter: {
      dehydrate: async (_mount, stackIds, signal) =>
        stackIds.length === 0 ? {} : ask('dehydrate', stackIds, signal),
      resend: async (_mount, stackIds, signal) =>
        stackIds.length === 0 ? {} : ask('resend', stackIds, signal),
      async changes(_mount, _cursor, signal) {
        // The integration runs only while its app does, and with nothing to
        // read, the record stays as it is until it connects again.
        if (!link) return null
        const held = await ask<unknown>('list', [], signal)
        // The core drops every file missing from the list, so a list with an
        // entry that is not an id would forget files the folder holds.
        if (!Array.isArray(held) || !held.every((id) => typeof id === 'string')) {
          throw new Error('The integration answered a list with no files')
        }
        // The integration keeps no list of changes, so the cursor is not
        // read and every read is answered with every file.
        return { cursor: 'list', full: held }
      },
    },

    attach(connection) {
      // The newest connection is the link: an integration that restarted
      // connects again before the daemon sees its old connection close.
      if (link) failAll('The integration reconnected')
      link = connection
      connection.onClose(() => {
        if (link !== connection) return
        link = null
        failAll('The integration disconnected')
      })
    },

    answer(request, results) {
      waiting.get(request)?.resolve(results)
    },
  }
}

/**
 * The adapter the daemon gives the core. A mount whose setting names a
 * Finder agent is reached through `finder`, and any other through the link.
 */
export function mountAdapter(link: MountLink, finder?: MountAdapter): MountAdapter {
  const pick = (mount: Mount) => (finder && mount.adapterConfig ? finder : link.adapter)
  return {
    dehydrate: (mount, stackIds, signal) => pick(mount).dehydrate(mount, stackIds, signal),
    resend: (mount, stackIds, signal) => pick(mount).resend(mount, stackIds, signal),
    changes: (mount, cursor, signal) => pick(mount).changes(mount, cursor, signal),
  }
}
