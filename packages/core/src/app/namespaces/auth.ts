import type { SdkAuthAdapters } from '../../adapters/auth'
import type { CryptoAdapter } from '../../adapters/crypto'
import type { StorageAdapter } from '../../adapters/storage'
import { hexToUint8, uint8ToHex } from '../../lib/hex'
import type { AppService } from '../service'

/** Builds the auth namespace: mnemonic hashing, app key management, and SDK auth builder. */
export function buildAuthNamespace(
  secrets: StorageAdapter,
  crypto: CryptoAdapter,
  sdkAuth: SdkAuthAdapters,
): AppService['auth'] {
  const MNEMONIC_HASH_KEY = 'mnemonicHash'
  const APP_KEYS_KEY = 'appKeys'

  async function hashMnemonic(mnemonic: string): Promise<string> {
    const encoder = new TextEncoder()
    return crypto.sha256(encoder.encode(mnemonic).buffer as ArrayBuffer)
  }

  async function getAppKeysMap(): Promise<Record<string, string>> {
    const raw = await secrets.getItem(APP_KEYS_KEY)
    if (!raw) return {}
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }

  async function setAppKeysMap(map: Record<string, string>): Promise<void> {
    await secrets.setItem(APP_KEYS_KEY, JSON.stringify(map))
  }

  return {
    async getMnemonicHash() {
      const hash = await secrets.getItem(MNEMONIC_HASH_KEY)
      return hash || null
    },
    async setMnemonicHash(mnemonic: string) {
      const hash = await hashMnemonic(mnemonic)
      await secrets.setItem(MNEMONIC_HASH_KEY, hash)
    },
    async validateMnemonic(mnemonic: string) {
      const storedHash = await secrets.getItem(MNEMONIC_HASH_KEY)
      if (!storedHash) return 'none' as const
      const inputHash = await hashMnemonic(mnemonic)
      return inputHash === storedHash
        ? ('valid' as const)
        : ('invalid' as const)
    },
    async clearMnemonicHash() {
      await secrets.deleteItem(MNEMONIC_HASH_KEY)
    },
    async getAppKey(indexerUrl: string) {
      const map = await getAppKeysMap()
      const hex = map[indexerUrl]
      if (!hex) return null
      return hexToUint8(hex)
    },
    async setAppKey(indexerUrl: string, key: Uint8Array) {
      const map = await getAppKeysMap()
      map[indexerUrl] = uint8ToHex(key)
      await setAppKeysMap(map)
    },
    async hasAppKey(indexerUrl: string) {
      const map = await getAppKeysMap()
      return indexerUrl in map
    },
    async getRegisteredIndexerURLs() {
      const map = await getAppKeysMap()
      return Object.keys(map)
    },
    async clearAppKeys() {
      await secrets.deleteItem(APP_KEYS_KEY)
    },
    builder: {
      async create(indexerUrl: string) {
        await sdkAuth.createBuilder(indexerUrl)
      },
      async requestConnection(appMeta: string) {
        return sdkAuth.requestConnection(appMeta)
      },
      async setConnectionResponse(appKey: string, response: string) {
        if (sdkAuth.setConnectionResponse) {
          await sdkAuth.setConnectionResponse(appKey, response)
        }
      },
      async waitForApproval() {
        await sdkAuth.waitForApproval()
      },
      async connectWithKey(keyHex: string) {
        return sdkAuth.connectWithKey(keyHex)
      },
      async register(mnemonic: string) {
        return sdkAuth.register(mnemonic)
      },
      cancel() {
        sdkAuth.cancelAuth()
      },
    },
    async generateRecoveryPhrase() {
      return sdkAuth.generateRecoveryPhrase()
    },
    async validateRecoveryPhrase(phrase: string) {
      await sdkAuth.validateRecoveryPhrase(phrase)
    },
    async onConnected(appKeyHex: string, indexerUrl: string) {
      const map = await getAppKeysMap()
      map[indexerUrl] = appKeyHex
      await setAppKeysMap(map)
      if (sdkAuth.onConnected) {
        await sdkAuth.onConnected(appKeyHex, indexerUrl)
      }
    },
  }
}
