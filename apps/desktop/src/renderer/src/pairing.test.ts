import { describe, expect, it, mock } from 'bun:test'
import type { AppService } from '@siastorage/core/app'

let daemonUp = true
mock.module('./api', () => ({
  sia: {
    daemonReachable: async () => daemonUp,
    openUrl: async () => {},
    connectDaemon: async () => ({ connected: true }),
  },
}))

const { checkPhrase, DAEMON_DOWN, REGISTER_FAILED, register, requestApproval } =
  await import('./pairing')

type Builder = Partial<AppService['auth']['builder']>

/** An app whose pairing calls all succeed, with `builder` laid over the SDK's part. */
function fakeApp(builder: Builder): AppService {
  return {
    settings: {
      getIndexerURL: async () => 'https://indexer.test',
      setIndexerURL: async () => {},
      setHasOnboarded: async () => {},
    },
    auth: {
      validateRecoveryPhrase: async () => {},
      validateMnemonic: async () => 'valid',
      setMnemonicHash: async () => {},
      onConnected: async () => {},
      builder: {
        create: async () => {},
        requestConnection: async () => 'https://indexer.test/approve',
        waitForApproval: async () => {},
        cancel: () => {},
        register: async () => 'key',
        ...builder,
      },
    },
  } as unknown as AppService
}

describe('pairing', () => {
  it('an account is reconnecting unless the SDK says it is new', async () => {
    const answer = (reconnecting: boolean | null) =>
      requestApproval(fakeApp({ reconnecting: async () => reconnecting }), () => {})

    expect(await answer(true)).toEqual({ reconnecting: true })
    expect(await answer(false)).toEqual({ reconnecting: false })
    expect(await answer(null)).toEqual({ reconnecting: true })
  })

  it("a phrase the SDK cannot check against a reconnecting account's keys is unverified", async () => {
    const app = fakeApp({ matchesExistingAppKey: async () => null })

    expect(await checkPhrase(app, 'phrase', { mustMatch: true })).toBe('unverified')
    expect(await checkPhrase(app, 'phrase', { mustMatch: false })).toBe('ok')
  })

  it('a registration that fails says to start over, or that the daemon is down', async () => {
    const app = fakeApp({
      register: async () => {
        throw new Error('no approved request at /tmp/sia.sock')
      },
    })

    daemonUp = true
    await expect(register(app, 'phrase', () => {})).rejects.toThrow(REGISTER_FAILED)
    daemonUp = false
    await expect(register(app, 'phrase', () => {})).rejects.toThrow(DAEMON_DOWN)
    daemonUp = true
  })
})
