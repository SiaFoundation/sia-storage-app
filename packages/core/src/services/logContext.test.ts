import * as loggerPkg from '@siastorage/logger'
import type { AppService } from '../app/service'
import { applyLogContext, refreshLogAccount } from './logContext'

function makeApp(deviceId: string, mnemonicHash: string | null): AppService {
  return {
    settings: { getDeviceId: async () => deviceId },
    auth: { getMnemonicHash: async () => mnemonicHash },
  } as unknown as AppService
}

describe('logContext', () => {
  it('applies device only when not authed', () => {
    const spy = jest.spyOn(loggerPkg, 'setLogContext')
    applyLogContext('dev-123', null)
    expect(spy).toHaveBeenLastCalledWith({ device: 'dev-123' })
    spy.mockRestore()
  })

  it('applies device + 8-char account prefix when authed', () => {
    const spy = jest.spyOn(loggerPkg, 'setLogContext')
    applyLogContext('dev-123', 'abcdef0123456789'.repeat(4))
    expect(spy).toHaveBeenLastCalledWith({ device: 'dev-123', account: 'abcdef01' })
    spy.mockRestore()
  })

  it('refreshLogAccount re-reads identity from the app and applies', async () => {
    const spy = jest.spyOn(loggerPkg, 'setLogContext')
    await refreshLogAccount(makeApp('dev-1', 'fedcba9876543210'.repeat(4)))
    expect(spy).toHaveBeenLastCalledWith({ device: 'dev-1', account: 'fedcba98' })
    spy.mockRestore()
  })
})
