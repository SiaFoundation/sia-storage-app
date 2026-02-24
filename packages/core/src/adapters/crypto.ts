export interface CryptoAdapter {
  sha256(data: ArrayBuffer): Promise<string>
}
