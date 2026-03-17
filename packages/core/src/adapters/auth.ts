export interface SdkAuthAdapters {
  createBuilder(indexerUrl: string): void | Promise<void>
  requestConnection(appMeta: string): Promise<string>
  setConnectionResponse?(appKey: string, response: string): void | Promise<void>
  waitForApproval(): Promise<void>
  connectWithKey(keyHex: string): Promise<boolean>
  register(mnemonic: string): Promise<string>
  generateRecoveryPhrase(): string | Promise<string>
  validateRecoveryPhrase(phrase: string): void | Promise<void>
  onConnected?(appKeyHex: string, indexerUrl: string): Promise<void>
  cancelAuth(): void
}
