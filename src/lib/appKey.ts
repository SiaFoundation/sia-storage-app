import { AppKey } from 'react-native-sia'
import { getRecoveryPhrase } from '../stores/settings'
import { hexToUint8 } from './hex'
import { APP_KEY } from '../config'

export async function getAppKey(): Promise<AppKey> {
  const seed = await getRecoveryPhrase()
  return new AppKey(seed, hexToUint8(APP_KEY).buffer)
}
