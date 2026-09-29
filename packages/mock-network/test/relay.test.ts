import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNetworkControl, type NetworkControl } from '../src/control'
import { RELAY_PATH } from '../src/protocol'
import { type MockNetwork, startMockNetwork } from '../src/server'

let dir: string
let network: MockNetwork
let control: NetworkControl

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mock-relay-'))
  network = startMockNetwork({ dir })
  control = createNetworkControl(network.url)
})

afterEach(async () => {
  await network.stop()
  rmSync(dir, { recursive: true, force: true })
})

/** Connects as an app would and answers each call with `answer`. */
async function connectDevice(name: string, answer: (method: string, args: unknown[]) => unknown) {
  const ws = new WebSocket(`${network.url.replace('http', 'ws')}${RELAY_PATH}/${name}`)
  ws.onmessage = (e) => {
    const { id, method, args } = JSON.parse(String(e.data))
    try {
      ws.send(JSON.stringify({ id, ok: true, result: answer(method, args) }))
    } catch (err) {
      ws.send(JSON.stringify({ id, ok: false, error: (err as Error).message }))
    }
  }
  await new Promise<void>((resolve) => ws.addEventListener('open', () => resolve()))
  return ws
}

test('a call reaches the named device and its answer comes back', async () => {
  await connectDevice('phone', (method, args) => ({ method, args }))
  expect(await control.connectedDevices()).toEqual({
    phone: { sockets: 1, lifecycle: 'foreground' },
  })
  expect(await control.callDevice<unknown>('phone', 'files.getById', ['abc'])).toEqual({
    method: 'files.getById',
    args: ['abc'],
  })
})

test('an error the app throws comes back as the call failing', async () => {
  await connectDevice('phone', () => {
    throw new Error('no such file')
  })
  await expect(control.callDevice('phone', 'files.getById', ['x'])).rejects.toThrow('no such file')
})

test('a call to a device with no socket fails at once', async () => {
  const started = Date.now()
  await expect(control.callDevice('tablet', 'files.getById', [])).rejects.toThrow(
    'tablet is not connected',
  )
  expect(Date.now() - started).toBeLessThan(1000)
})

test('a device that disconnects is no longer listed', async () => {
  const ws = await connectDevice('phone', () => null)
  ws.close()
  for (let i = 0; i < 20 && 'phone' in (await control.connectedDevices()); i++) await Bun.sleep(50)
  expect(await control.connectedDevices()).toEqual({})
})

test('a call to a device that reported moving to the background fails at once', async () => {
  const ws = await connectDevice('phone', () => 'answered')
  const lifecycle = async () => (await control.connectedDevices()).phone?.lifecycle
  ws.send(JSON.stringify({ lifecycle: 'background' }))
  for (let i = 0; i < 20 && (await lifecycle()) !== 'background'; i++) await Bun.sleep(50)
  expect(await lifecycle()).toBe('background')
  await expect(control.callDevice('phone', 'files.getById', [])).rejects.toThrow(
    'in the background',
  )
  ws.send(JSON.stringify({ lifecycle: 'foreground' }))
  for (let i = 0; i < 20 && (await lifecycle()) !== 'foreground'; i++) await Bun.sleep(50)
  expect(await control.callDevice<string>('phone', 'files.getById', [])).toBe('answered')
})

test('a call waiting on a device that disconnects fails at once', async () => {
  const ws = new WebSocket(`${network.url.replace('http', 'ws')}${RELAY_PATH}/phone`)
  await new Promise<void>((resolve) => ws.addEventListener('open', () => resolve()))
  ws.onmessage = () => ws.close()
  const started = Date.now()
  await expect(control.callDevice('phone', 'files.getById', [])).rejects.toThrow(
    'phone disconnected before answering',
  )
  expect(Date.now() - started).toBeLessThan(1000)
})

test('a reconnecting device counts one more socket opened', async () => {
  const first = await connectDevice('phone', () => null)
  first.close()
  await connectDevice('phone', () => null)
  expect((await control.connectedDevices()).phone?.sockets).toBe(2)
})
