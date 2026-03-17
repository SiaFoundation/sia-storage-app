import type { CryptoAdapter } from '@siastorage/core/adapters'
import QuickCrypto from 'react-native-quick-crypto'

export function createCryptoAdapter(): CryptoAdapter {
  return {
    sha256: async (data) => {
      const h = QuickCrypto.createHash('sha256')
      h.update(data)
      return h.digest('hex')
    },
  }
}
