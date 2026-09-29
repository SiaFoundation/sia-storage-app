/**
 * Sign-in for simulation test mode. Approves at once, hands out a fixed app
 * key and recovery phrase, and connects to the mock network.
 */
import type { SdkAdapter } from '@siastorage/core/adapters'
import { createRemoteSdk, type FileSender } from '@siastorage/mock-network/client'
import { MOCK_APP_KEY_HEX, MOCK_PHRASE } from '@siastorage/mock-network/protocol'
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy'
import type { MobileSdkAuth } from '../adapters/auth'

/**
 * Streams the file from disk in native code. The real SDK reads upload files
 * itself, so bytes pulled through JavaScript here would be a cost the app
 * does not have.
 */
const sendFileNatively: FileSender = async (path, blobsUrl, headers) => {
  const uri = path.startsWith('file://') ? path : `file://${path}`
  const res = await uploadAsync(blobsUrl, uri, {
    httpMethod: 'POST',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers,
  })
  if (res.status >= 400) throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 300)}`)
  const body = JSON.parse(res.body) as { blobId: string; size: string }
  return { blobId: body.blobId, size: body.size }
}

export class SimSdkAuth implements MobileSdkAuth {
  private readonly sdk: SdkAdapter
  private connected = false
  private onConnectedHandler: ((appKeyHex: string, indexerUrl: string) => Promise<void>) | null =
    null

  constructor(network: { url: string; device: string }) {
    this.sdk = createRemoteSdk({ ...network, sendFile: sendFileNatively })
  }

  setOnConnected(handler: (appKeyHex: string, indexerUrl: string) => Promise<void>): void {
    this.onConnectedHandler = handler
  }

  getLastSdkAdapter(): SdkAdapter | null {
    return this.connected ? this.sdk : null
  }

  createBuilder(): void {}

  async requestConnection(): Promise<string> {
    return 'sia://callback'
  }

  async waitForApproval(): Promise<void> {}

  async connectWithKey(): Promise<boolean> {
    this.connected = true
    return true
  }

  async register(): Promise<string> {
    this.connected = true
    return MOCK_APP_KEY_HEX
  }

  generateRecoveryPhrase(): string {
    return MOCK_PHRASE
  }

  validateRecoveryPhrase(): void {}

  async onConnected(appKeyHex: string, indexerUrl: string): Promise<void> {
    await this.onConnectedHandler?.(appKeyHex, indexerUrl)
  }

  cancelAuth(): void {}
}
