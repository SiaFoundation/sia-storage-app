import { AppKey } from 'react-native-sia'
import { getRecoveryPhrase } from '../stores/settings'
import { hexToUint8 } from './hex'
import { APP_KEY } from '../config'

// Cache the app key so that it can be accessed by background tasks.
// Background tasks run with the suspended app state, but cannot access values in SecureStore.
let appKey: AppKey | undefined = undefined

export async function getAppKey(): Promise<AppKey> {
  if (appKey) return appKey
  const recoveryPhrase = await getRecoveryPhrase()
  if (!recoveryPhrase) {
    throw new Error('Recovery phrase not found')
  }
  appKey = new AppKey(recoveryPhrase, hexToUint8(APP_KEY).buffer)
  return appKey
}
