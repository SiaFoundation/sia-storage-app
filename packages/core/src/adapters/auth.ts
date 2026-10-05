export interface SdkAuthAdapters {
  createBuilder(indexerUrl: string, appMeta: string): void | Promise<void>
  requestConnection(): Promise<string>
  setConnectionResponse?(appKey: string, response: string): void | Promise<void>
  waitForApproval(): Promise<void>
  /**
   * Whether the account that approved the request already has this app
   * registered. Only valid once `waitForApproval` has resolved. Absent on an
   * SDK that does not report it.
   */
  reconnecting?(): boolean | Promise<boolean>
  /**
   * Whether `mnemonic` derives an app key the approving account already has.
   * One account can hold keys under several phrases, so `reconnecting` alone
   * does not say a given phrase is one of them. Only valid once
   * `waitForApproval` has resolved, and absent where `reconnecting` is.
   */
  matchesExistingAppKey?(mnemonic: string): Promise<boolean>
  connectWithKey(keyHex: string): Promise<boolean>
  register(mnemonic: string): Promise<string>
  generateRecoveryPhrase(): string | Promise<string>
  validateRecoveryPhrase(phrase: string): void | Promise<void>
  onConnected?(appKeyHex: string, indexerUrl: string): Promise<void>
  cancelAuth(): void
}
