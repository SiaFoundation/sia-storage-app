import { hexToUint8 } from '@siastorage/core'
import type { SdkAuthAdapters } from '@siastorage/core/adapters'
import {
  AppKey,
  Builder,
  generateRecoveryPhrase,
  type SdkInterface,
  validateRecoveryPhrase,
} from 'react-native-sia'

function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export class MobileSdkAuthAdapter implements SdkAuthAdapters {
  private builder: Builder | null = null
  private abortController: AbortController | null = null
  private lastSdk: SdkInterface | null = null
  private _onConnected:
    | ((appKeyHex: string, indexerUrl: string) => Promise<void>)
    | null = null

  setOnConnected(
    handler: (appKeyHex: string, indexerUrl: string) => Promise<void>,
  ): void {
    this._onConnected = handler
  }

  getLastSdk(): SdkInterface | null {
    return this.lastSdk
  }

  createBuilder(indexerUrl: string, appMetaJson: string): void {
    const meta = JSON.parse(appMetaJson) as {
      appID: string
      name: string
      description: string
      serviceURL: string
      callbackUrl?: string
      logoUrl?: string
    }
    this.builder = new Builder(indexerUrl, {
      id: hexToUint8(meta.appID).buffer as ArrayBuffer,
      name: meta.name,
      description: meta.description,
      serviceUrl: meta.serviceURL,
      callbackUrl: meta.callbackUrl,
      logoUrl: meta.logoUrl,
    })
  }

  async requestConnection(): Promise<string> {
    if (!this.builder) throw new Error('No builder instance')
    await this.builder.requestConnection()
    return this.builder.responseUrl()
  }

  async waitForApproval(): Promise<void> {
    if (!this.builder) throw new Error('No builder instance')
    this.abortController = new AbortController()
    await this.builder.waitForApproval({ signal: this.abortController.signal })
    this.abortController = null
  }

  async connectWithKey(keyHex: string): Promise<boolean> {
    if (!this.builder) throw new Error('No builder instance')
    const keyBytes = hexToUint8(keyHex)
    const appKey = new AppKey(keyBytes.buffer as ArrayBuffer)
    const sdk = await this.builder.connected(appKey)
    if (sdk) {
      this.lastSdk = sdk
      return true
    }
    return false
  }

  async register(mnemonic: string): Promise<string> {
    if (!this.builder) throw new Error('No builder instance')
    const sdk = await this.builder.register(mnemonic)
    this.lastSdk = sdk
    const appKey = sdk.appKey()
    return uint8ToHex(new Uint8Array(appKey.export_()))
  }

  generateRecoveryPhrase(): string {
    return generateRecoveryPhrase()
  }

  validateRecoveryPhrase(phrase: string): void {
    validateRecoveryPhrase(phrase)
  }

  async onConnected(appKeyHex: string, indexerUrl: string): Promise<void> {
    if (this._onConnected) {
      await this._onConnected(appKeyHex, indexerUrl)
    }
  }

  cancelAuth(): void {
    this.abortController?.abort()
    this.abortController = null
  }
}
