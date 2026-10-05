/**
 * Sign-in against the mock network, for Node and Bun processes: the calls the
 * real SDK's connection builder makes, as requests a test can approve, deny
 * and inspect.
 *
 * The network is one account. An app key here is the SHA-256 of the recovery
 * phrase, which keeps the one property sign-in depends on: the same phrase
 * gives the same key on every device, and a different phrase gives another.
 */
import { createHash } from 'node:crypto'
import type { SdkAuthAdapters } from '@siastorage/core/adapters'
import { DEVICE_HEADER, type WireApproval, type WireConnectionRequest } from '../protocol'
import { parse } from './index'

/** How often a waiting sign-in asks whether its request has been settled. */
const APPROVAL_POLL_MS = 250

/** The methods that reach the network. Phrase generation and validation stay with the caller. */
export type RemoteAuth = Required<
  Pick<
    SdkAuthAdapters,
    | 'createBuilder'
    | 'requestConnection'
    | 'waitForApproval'
    | 'reconnecting'
    | 'matchesExistingAppKey'
    | 'connectWithKey'
    | 'register'
    | 'cancelAuth'
  >
>

export function mockAppKey(mnemonic: string): string {
  return createHash('sha256').update(mnemonic).digest('hex')
}

export function createNodeRemoteAuth(options: { url: string; device: string }): RemoteAuth {
  const base = `${options.url.replace(/\/$/, '')}/sdk/auth`
  const headers = { [DEVICE_HEADER]: options.device, 'content-type': 'application/json' }
  let requestId: string | null = null
  let approval: WireApproval | null = null
  /** Bumped by `cancelAuth`, so a wait that began before it gives up at its next poll. */
  let generation = 0

  const call = async (path: string, init: RequestInit = {}): Promise<unknown> =>
    parse(await fetch(`${base}${path}`, { ...init, headers }))
  const post = (path: string, body: unknown) =>
    call(path, { method: 'POST', body: JSON.stringify(body) })

  function approved(): string {
    if (!requestId || approval?.state !== 'approved') {
      throw new Error('The connection request has not been approved')
    }
    return requestId
  }

  return {
    createBuilder() {
      requestId = null
      approval = null
    },

    async requestConnection() {
      const request = (await post('/requests', {})) as WireConnectionRequest
      requestId = request.requestId
      approval = null
      return request.approvalUrl
    },

    async waitForApproval() {
      if (!requestId) throw new Error('No connection request')
      const mine = ++generation
      for (;;) {
        const status = (await call(`/requests/${requestId}`)) as WireApproval
        if (mine !== generation) throw new Error('Auth cancelled')
        if (status.state === 'denied') throw new Error('Connection request denied')
        if (status.state === 'approved') {
          approval = status
          return
        }
        await new Promise((resolve) => setTimeout(resolve, APPROVAL_POLL_MS))
        if (mine !== generation) throw new Error('Auth cancelled')
      }
    },

    reconnecting() {
      approved()
      return approval?.reconnecting ?? false
    },

    async matchesExistingAppKey(mnemonic) {
      const body = await post(`/requests/${approved()}/matches`, { appKey: mockAppKey(mnemonic) })
      return (body as { matches: boolean }).matches
    },

    async register(mnemonic) {
      const appKey = mockAppKey(mnemonic)
      await post(`/requests/${approved()}/register`, { appKey })
      return appKey
    },

    async connectWithKey(keyHex) {
      const body = await post('/connected', { appKey: keyHex })
      return (body as { connected: boolean }).connected
    },

    cancelAuth() {
      generation += 1
    },
  }
}
