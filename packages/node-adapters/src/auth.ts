import { hexToUint8, uint8ToHex } from '@siastorage/core'
import type { SdkAuthAdapters } from '@siastorage/core/adapters'
import { logger } from '@siastorage/logger'
import {
  AppKey,
  type AppMetadata,
  Builder,
  type Sdk,
  generateRecoveryPhrase,
  initSia,
  setLogger,
  validateRecoveryPhrase,
} from '@siafoundation/sia-storage'

export type NodeSdkAuthResult = {
  adapters: SdkAuthAdapters
  /**
   * Returns the raw native SDK after a successful connect/register.
   * Intended for `createNodeSdkAdapter(getLastSdk()!)` during daemon bootstrap.
   */
  getLastSdk(): Sdk | null
}

/** Parses the JSON contract used by `app.auth.builder.create(indexerURL, appMetaJson)`. */
function parseAppMeta(json: string): AppMetadata {
  const parsed = JSON.parse(json) as {
    appID: string
    name: string
    description: string
    serviceURL: string
    callbackUrl?: string
    logoUrl?: string
  }
  return {
    id: Buffer.from(parsed.appID, 'hex'),
    name: parsed.name,
    description: parsed.description,
    serviceUrl: parsed.serviceURL,
    callbackUrl: parsed.callbackUrl,
    logoUrl: parsed.logoUrl,
  }
}

export function createNodeSdkAuthAdapter(): NodeSdkAuthResult {
  let builder: Builder | null = null
  let abortController: AbortController | null = null
  let lastSdk: Sdk | null = null
  let initialized = false

  async function ensureInit() {
    if (initialized) return
    await initSia()
    setLogger((message) => logger.debug('sdk', message), 'debug')
    initialized = true
  }

  const adapters: SdkAuthAdapters = {
    async createBuilder(indexerUrl: string, appMetaJson: string): Promise<void> {
      await ensureInit()
      builder = new Builder(indexerUrl, parseAppMeta(appMetaJson))
    },

    async requestConnection(): Promise<string> {
      if (!builder) throw new Error('No builder instance')
      await builder.requestConnection()
      return builder.responseUrl()
    },

    async waitForApproval(): Promise<void> {
      if (!builder) throw new Error('No builder instance')
      abortController = new AbortController()
      const abortPromise = new Promise<never>((_, reject) => {
        abortController!.signal.addEventListener('abort', () => {
          reject(new Error('Auth cancelled'))
        })
      })
      try {
        await Promise.race([builder.waitForApproval(), abortPromise])
      } finally {
        abortController = null
      }
    },

    async connectWithKey(keyHex: string): Promise<boolean> {
      if (!builder) throw new Error('No builder instance')
      await ensureInit()
      const appKey = new AppKey(Buffer.from(hexToUint8(keyHex)))
      const sdk = await builder.connected(appKey)
      if (!sdk) return false
      lastSdk = sdk
      return true
    },

    async register(mnemonic: string): Promise<string> {
      if (!builder) throw new Error('No builder instance')
      const sdk = await builder.register(mnemonic)
      lastSdk = sdk
      return uint8ToHex(new Uint8Array(sdk.appKey().export()))
    },

    generateRecoveryPhrase(): string {
      return generateRecoveryPhrase()
    },

    validateRecoveryPhrase(phrase: string): void {
      validateRecoveryPhrase(phrase)
    },

    cancelAuth(): void {
      abortController?.abort()
      abortController = null
    },
  }

  return {
    adapters,
    getLastSdk() {
      return lastSdk
    },
  }
}
