/**
 * Every device kind sim can run, and what each needs released when a
 * checkout is done with sim. Adding a kind is one entry here, and the `up`
 * options, `--phone` choices and `prune --all` all follow from the table.
 */
import * as emulators from '../android/emulators'
import * as simulators from '../ios/pool'
import { stopMetro } from '../metro'
import type { DeviceKind, PhoneKind, Session } from '../session'
import { stopAppium } from '../ui/server'
import { AndroidDevice } from './android'
import { CliDevice } from './cli'
import * as desktop from './desktop'
import { IosDevice } from './ios'
import type { Device } from './types'

export type { Device, LibraryEntry } from './types'
export { CliDevice } from './cli'
export { DesktopDevice } from './desktop'
export { IosDevice } from './ios'
export { PhoneDevice, PhoneStartFailed } from './phone'

type KindEntry = {
  open(name: string, session: Session): Device
  /** Hands back what this kind holds across sessions, such as pooled simulators, and returns their names. */
  release?(): Promise<string[]>
  /** Shuts down pooled devices no session has held for `idleMs`, and returns their names. */
  reap?(idleMs: number): Promise<string[]>
  /** Whether a session holds a pooled device, or one handed back within `idleMs` is still on. */
  busy?(idleMs: number): boolean
}

const KINDS: Record<DeviceKind, KindEntry> = {
  cli: { open: (name, session) => new CliDevice(name, session) },
  ios: {
    open: (name, session) => new IosDevice(name, session),
    release: simulators.drain,
    reap: simulators.shutdownIdle,
    busy: simulators.busy,
  },
  android: {
    open: (name, session) => new AndroidDevice(name, session),
    release: emulators.drain,
    reap: emulators.stopIdle,
    busy: emulators.busy,
  },
  desktop: {
    open: (name, session) => new desktop.DesktopDevice(name, session),
    release: desktop.release,
  },
}

/** Servers every phone shares, stopped once no session needs them. */
const SHARED_SERVERS: Array<(inUse?: () => boolean) => Promise<void>> = [stopMetro, stopAppium]

export const DEVICE_KINDS = Object.keys(KINDS) as DeviceKind[]

export type { PhoneKind }
export const PHONE_KINDS = DEVICE_KINDS.filter(
  (k): k is PhoneKind => k === 'ios' || k === 'android',
)

/** Records a new device in the session and returns it, not yet started. */
export async function addDevice(session: Session, name: string, kind: DeviceKind): Promise<Device> {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`Device names are lowercase letters, digits and dashes: ${name}`)
  }
  await session.update((s) => {
    if (s.devices[name]) throw new Error(`Device ${name} already exists`)
    // The desktop test build has one app and one Finder folder per Mac, and
    // its lease is the session's, so a second desktop device would quit the
    // first one's app and wipe their shared folder when it started.
    const desktop = Object.entries(s.devices).find(([, d]) => d.kind === 'desktop')
    if (kind === 'desktop' && desktop) {
      throw new Error(`Session ${session.name} already has a desktop device, ${desktop[0]}`)
    }
    s.devices[name] = { kind, dir: session.deviceDir(name) }
  })
  return openDevice(session, name)
}

export function openDevice(session: Session, name: string): Device {
  const record = session.state.devices[name]
  if (!record) {
    const known = Object.keys(session.state.devices).join(', ') || 'none'
    throw new Error(`No device ${name} in session ${session.name} (devices: ${known})`)
  }
  return KINDS[record.kind].open(name, session)
}

export function allDevices(session: Session): Device[] {
  return Object.keys(session.state.devices).map((name) => openDevice(session, name))
}

/** Releases every kind's machine resources and the shared servers, and returns what it released. */
export async function releaseAllKinds(): Promise<string[]> {
  const released: string[] = []
  for (const kind of DEVICE_KINDS) released.push(...((await KINDS[kind].release?.()) ?? []))
  await stopSharedServers()
  return released
}

/** Shuts down every kind's pooled devices no session has held for `idleMs`, and returns their names. */
export async function reapAllKinds(idleMs: number): Promise<string[]> {
  const reaped: string[] = []
  for (const kind of DEVICE_KINDS) reaped.push(...((await KINDS[kind].reap?.(idleMs)) ?? []))
  return reaped
}

export function anyKindBusy(idleMs: number): boolean {
  return DEVICE_KINDS.some((kind) => KINDS[kind].busy?.(idleMs))
}

/** Stops Metro and Appium, each unless `inUse`, checked under its start lock, says to keep it. */
export async function stopSharedServers(inUse?: () => boolean): Promise<void> {
  for (const stop of SHARED_SERVERS) await stop(inUse)
}
