import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNodeRemoteAuth, mockAppKey, type RemoteAuth } from '../src/client/auth'
import { createNetworkControl, type NetworkControl } from '../src/control'
import { type MockNetwork, startMockNetwork } from '../src/server'

const PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHER_PHRASE = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'

let dir: string
let network: MockNetwork
let control: NetworkControl
let phone: RemoteAuth
let laptop: RemoteAuth

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mock-network-auth-'))
  network = startMockNetwork({ dir: join(dir, 'state'), publishEveryMs: 0 })
  control = createNetworkControl(network.url)
  phone = createNodeRemoteAuth({ url: network.url, device: 'phone' })
  laptop = createNodeRemoteAuth({ url: network.url, device: 'laptop' })
})

afterEach(async () => {
  await network.stop()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * How a wait ended: `approved`, or the message it rejected with. Attached when
 * the wait starts, so a rejection that lands before the test looks at it is
 * never unhandled.
 */
const settled = (wait: Promise<void>): Promise<string> =>
  wait.then(
    () => 'approved',
    (e: Error) => e.message,
  )

/** Signs a device in the way `sia connect` does: request, wait, register. */
async function signIn(auth: RemoteAuth, phrase = PHRASE): Promise<string> {
  await auth.createBuilder('https://sia.storage', '{}')
  await auth.requestConnection()
  await auth.waitForApproval()
  return auth.register(phrase)
}

describe('signing in on the mock network', () => {
  test('approves a request as it arrives unless a test asks to settle them itself', async () => {
    await phone.createBuilder('https://sia.storage', '{}')
    const url = await phone.requestConnection()

    await phone.waitForApproval()

    expect(url).toStartWith(`${network.url}/approve/`)
    expect((await control.auth()).requests).toEqual([
      { id: 'request-1', device: 'phone', state: 'approved', reconnecting: false },
    ])
  })

  test('the first device to sign in is not reconnecting, and the next one is', async () => {
    await phone.createBuilder('https://sia.storage', '{}')
    await phone.requestConnection()
    await phone.waitForApproval()
    expect(await phone.reconnecting()).toBe(false)
    await phone.register(PHRASE)

    await laptop.createBuilder('https://sia.storage', '{}')
    await laptop.requestConnection()
    await laptop.waitForApproval()

    expect(await laptop.reconnecting()).toBe(true)
  })

  test('a device registering its own key does not turn its answer to reconnecting', async () => {
    await signIn(phone)

    expect(await phone.reconnecting()).toBe(false)
  })

  test('one phrase gives every device the same key, and the account holds it once', async () => {
    const first = await signIn(phone)
    const second = await signIn(laptop)

    expect(second).toBe(first)
    expect(first).toBe(mockAppKey(PHRASE))
    expect((await control.auth()).appKeys).toEqual([{ key: first, device: 'phone' }])
  })

  test('tells a phrase the account already has from one it does not', async () => {
    await signIn(phone)
    await laptop.createBuilder('https://sia.storage', '{}')
    await laptop.requestConnection()
    await laptop.waitForApproval()

    expect(await laptop.matchesExistingAppKey(PHRASE)).toBe(true)
    expect(await laptop.matchesExistingAppKey(OTHER_PHRASE)).toBe(false)
  })

  test('a key connects only once it has been registered', async () => {
    expect(await phone.connectWithKey(mockAppKey(PHRASE))).toBe(false)

    await signIn(phone)

    expect(await laptop.connectWithKey(mockAppKey(PHRASE))).toBe(true)
    expect(await laptop.connectWithKey(mockAppKey(OTHER_PHRASE))).toBe(false)
  })

  test('the app keys survive the network restarting on the same state', async () => {
    await signIn(phone)
    await network.stop()
    network = startMockNetwork({ dir: join(dir, 'state'), publishEveryMs: 0 })
    laptop = createNodeRemoteAuth({ url: network.url, device: 'laptop' })

    await laptop.createBuilder('https://sia.storage', '{}')
    await laptop.requestConnection()
    await laptop.waitForApproval()

    expect(await laptop.reconnecting()).toBe(true)
  })
})

describe('a test settling connection requests itself', () => {
  beforeEach(async () => {
    await control.setApprovalMode('manual')
    await phone.createBuilder('https://sia.storage', '{}')
    await phone.requestConnection()
  })

  test('a request waits until it is approved', async () => {
    let settled = false
    const waiting = phone.waitForApproval().then(() => {
      settled = true
    })
    await Bun.sleep(400)
    expect(settled).toBe(false)
    expect((await control.auth()).requests[0].state).toBe('pending')

    expect(await control.approve()).toBe(1)
    await waiting

    expect(settled).toBe(true)
  })

  test('a denied request fails the wait', async () => {
    const outcome = settled(phone.waitForApproval())

    await control.deny()

    expect(await outcome).toBe('Connection request denied')
  })

  test('a cancelled wait ends without the request being settled', async () => {
    const outcome = settled(phone.waitForApproval())

    phone.cancelAuth()

    expect(await outcome).toBe('Auth cancelled')
    expect((await control.auth()).requests[0].state).toBe('pending')
  })

  test('nothing registers, and no phrase is checked, before approval', async () => {
    await expect(phone.register(PHRASE)).rejects.toThrow('has not been approved')
    await expect(phone.matchesExistingAppKey(PHRASE)).rejects.toThrow('has not been approved')
    expect(() => phone.reconnecting()).toThrow('has not been approved')
    expect((await control.auth()).appKeys).toEqual([])
  })

  test('approving one request leaves the others pending', async () => {
    await laptop.createBuilder('https://sia.storage', '{}')
    await laptop.requestConnection()

    await control.approve('request-2')

    expect((await control.auth()).requests.map((r) => [r.device, r.state])).toEqual([
      ['phone', 'pending'],
      ['laptop', 'approved'],
    ])
  })
})

describe('sign-in under network conditions', () => {
  test('an offline device cannot ask for a connection', async () => {
    await control.setOffline('phone', true)
    await phone.createBuilder('https://sia.storage', '{}')

    await expect(phone.requestConnection()).rejects.toThrow('Network unavailable')
  })

  test('a fault on auth fails the next sign-in call and is logged', async () => {
    await control.addFault({ op: 'auth', device: 'phone', message: 'indexer down' })
    await phone.createBuilder('https://sia.storage', '{}')

    await expect(phone.requestConnection()).rejects.toThrow('indexer down')
    expect((await control.requests({ op: 'auth' })).map((r) => r.status)).toEqual([500])
  })
})
