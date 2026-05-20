import { setLogContext } from '@siastorage/logger'
import type { AppService } from '../app/service'

const ID_PREFIX_LEN = 8

/** Tag every subsequent log entry with `device` and (if signed in) `account`. */
export function applyLogContext(deviceId: string, mnemonicHash: string | null): void {
  const account = mnemonicHash ? mnemonicHash.slice(0, ID_PREFIX_LEN) : null
  setLogContext(account ? { device: deviceId, account } : { device: deviceId })
}

/** Re-read identity from the app service and apply. Call after sign-in. */
export async function refreshLogAccount(app: AppService): Promise<void> {
  const [deviceId, mnemonicHash] = await Promise.all([
    app.settings.getDeviceId(),
    app.auth.getMnemonicHash(),
  ])
  applyLogContext(deviceId, mnemonicHash)
}
