import type { CryptoAdapter } from '@siastorage/core/adapters'
import * as crypto from 'crypto'

export function createNodeCryptoAdapter(): CryptoAdapter {
  return {
    async sha256(data: ArrayBuffer): Promise<string> {
      return crypto.createHash('sha256').update(Buffer.from(data)).digest('hex')
    },
  }
}
