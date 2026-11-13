/*
 * The mount adapter for an integration that stays connected to the daemon.
 *
 * The daemon has to ask the operating system two things about the mount, the
 * folder a file manager shows: remove your copy of these files, and hand
 * these files' bytes back. On macOS only a program inside the app can ask, so
 * the daemon runs one per call (`finderAgent.ts`). Where the integration is a
 * program of ours that runs for as long as the mount is up, such as a Windows
 * sync root provider, it can ask the system itself, and this file carries the
 * question to it.
 *
 * The integration calls `mount` on a connection and keeps it open. Each
 * question goes down that connection as a frame, and the integration answers
 * with a `mountAnswer` call naming the frame's request id. Such an
 * integration is told by the system about every file it removes, and reports
 * those through `provider.mountReport`, so there is no list of changes to
 * read here.
 */
import type { Mount, MountAdapter } from '@siastorage/core/adapters'
import type { IpcConnection } from '@siastorage/node-adapters'

/**
 * Removing a copy is a local file operation, so a full call ends far inside
 * this. A timeout loses every answer in the call.
 */
const REQUEST_TIMEOUT_MS = 60_000

/** One question sent to the integration. */
export type MountRequestFrame = {
  event: 'mount'
  /** Names this question in the `mountAnswer` that answers it. */
  request: string
  verb: 'dehydrate' | 'resend'
  stackIds: string[]
}

export type MountLink = {
  /** Asks over the link. A call rejects while no integration holds the link open. */
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
  async function ask<T extends string>(
    verb: MountRequestFrame['verb'],
    stackIds: string[],
    signal?: AbortSignal,
  ): Promise<Record<string, T>> {
    if (stackIds.length === 0) return {}
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
      return results as Record<string, T>
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      waiting.delete(request)
    }
  }

  return {
    adapter: {
      dehydrate: (_mount, stackIds, signal) => ask('dehydrate', stackIds, signal),
      resend: (_mount, stackIds, signal) => ask('resend', stackIds, signal),
      // The integration reports each change as it happens instead.
      changes: async () => null,
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
