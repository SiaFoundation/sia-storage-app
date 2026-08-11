/*
 * Drops the panel to 1% after a stretch of no user interaction, but only
 * while a keep-awake lock is held. Any touch brings it back.
 *
 * Lowering the backlight rather than drawing a black overlay, because an
 * overlay saves no power on LCD.
 *
 * setBrightnessAsync is window-scoped on Android, where the OS reverts it
 * whenever our activity leaves the front. Restoring there clears the window
 * override rather than writing the captured level back, since a numeric
 * override stops the window following auto-brightness and the slider until
 * the activity ends. On iOS it moves the real system brightness and that
 * survives until the device locks, so the captured level is persisted there:
 * a crash while dimmed would otherwise strand the user at 1%.
 */

import { logger } from '@siastorage/logger'
import { swrState } from '@siastorage/core/stores'
import * as Brightness from 'expo-brightness'
import { AppState, Platform } from 'react-native'
import { app } from '../stores/appService'
import { isAutoKeepAwakeHeld, subscribeAutoKeepAwake } from './autoKeepAwake'

const IDLE_DELAY_MS = 60_000
const DIM_LEVEL = 0.01
const BRIGHTNESS_EPSILON = 0.02

// iOS only. Its presence at launch means a previous run died dimmed. Android
// starts each launch with no window override, so a saved level there would
// only push a stale value onto a window that was already correct.
const PERSISTED_LEVEL_KEY = 'screenDimRestoreLevel'

type Phase = 'off' | 'armed' | 'dimmed'

const phase = swrState<Phase>('off')
const locks = new Set<'manual' | 'auto'>()
const teardowns: Array<() => void> = []
let capturedLevel: number | null = null
// Bumped by every touch and every disarm, so a dim that was already running
// when one landed can tell and leave the panel bright.
let activity = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null
let brightnessQueue = Promise.resolve()

// Serialized so a restore can never interleave with the dim it undoes, where
// it would read the pre-dim level, skip its write on the epsilon check, and
// leave the panel dark.
function enqueue(work: () => Promise<void>): void {
  brightnessQueue = brightnessQueue.then(work).catch((error) => {
    logger.warn('screenDim', 'brightness_failed', { error: error as Error })
  })
}

/**
 * Whether the app is on screen with nothing over it. The shared lifecycle
 * counts iOS `inactive` as foreground, but Control Center and the app
 * switcher make the app inactive with its brightness showing, so the dim
 * reads AppState itself: it restores on `inactive` and dims only while
 * `active`.
 */
function onScreen(): boolean {
  return AppState.currentState === 'active'
}

function clearIdleTimer(): void {
  if (idleTimer === null) return
  clearTimeout(idleTimer)
  idleTimer = null
}

function startIdleTimer(): void {
  clearIdleTimer()
  idleTimer = setTimeout(() => {
    idleTimer = null
    enqueue(dim)
  }, IDLE_DELAY_MS)
}

async function persistLevel(level: number): Promise<void> {
  if (Platform.OS !== 'ios') return
  await app().storage.setItem(PERSISTED_LEVEL_KEY, String(level))
}

async function clearPersistedLevel(): Promise<void> {
  if (Platform.OS !== 'ios') return
  await app().storage.removeItem(PERSISTED_LEVEL_KEY)
}

async function dim(): Promise<void> {
  // Re-read: a background transition or a lock release can land between the
  // timer firing and this running.
  if (phase.getState() !== 'armed' || !locks.size || !onScreen()) return
  const touches = activity

  // A level still held means the last restore failed and the panel is still
  // at 1%, so reading it again would record 1% as the level to go back to.
  if (capturedLevel === null) {
    const level = await Brightness.getBrightnessAsync()
    if (phase.getState() !== 'armed' || activity !== touches) return

    // Persist before the write. A crash in between restores a level the panel
    // already has. A crash after an unrecorded write strands it at 1%.
    await persistLevel(level)
    if (phase.getState() !== 'armed' || activity !== touches) {
      // Nothing was written, so nothing is held. Kept, the saved level
      // would be put back after a later dim, over whatever the user set
      // in between.
      await clearPersistedLevel()
      return
    }
    capturedLevel = level
  }
  if (phase.getState() !== 'armed' || activity !== touches) return

  try {
    await Brightness.setBrightnessAsync(DIM_LEVEL)
  } catch (error) {
    // Never enter 'dimmed' on a failed write, or restore targets a level we
    // never set.
    capturedLevel = null
    await clearPersistedLevel()
    throw error
  }

  // A disarm that landed mid-write queued the restore that undoes this.
  // Leaving the phase alone lets that restore win.
  if (phase.getState() !== 'armed') return
  // A touch that landed mid-write found the phase still armed and only
  // restarted the timer, so the panel goes back up here.
  if (activity !== touches) return restore()
  phase.setState('dimmed')
}

/**
 * No-op unless a dim recorded a level, so every exit path can call it. The
 * level is let go only once the panel and the persisted key are both back,
 * so a restore that throws is tried again by the next exit or touch.
 */
async function restore(): Promise<void> {
  const level = capturedLevel
  if (level === null) return

  if (Platform.OS === 'android') {
    await Brightness.restoreSystemBrightnessAsync()
  } else {
    // Anything but our own dim level means the user or iOS auto-brightness
    // moved it while we were dimmed. Keep theirs.
    const current = await Brightness.getBrightnessAsync()
    if (Math.abs(current - DIM_LEVEL) <= BRIGHTNESS_EPSILON) {
      await Brightness.setBrightnessAsync(level)
    }
  }
  // Cleared last: a throw above leaves the key for crash recovery next launch.
  await clearPersistedLevel()
  capturedLevel = null
}

function arm(): void {
  if (phase.getState() !== 'off' || !locks.size || !onScreen()) return
  phase.setState('armed')
  startIdleTimer()
}

function disarm(): void {
  if (phase.getState() === 'off') return
  clearIdleTimer()
  // A dim still writing would otherwise see the phase armed again after a
  // quick re-arm and mark the screen dimmed after this restore has run.
  activity++
  phase.setState('off')
  // Queued even from 'armed': a dim still in flight has already recorded the
  // level it is about to write, and this runs behind it.
  enqueue(restore)
}

function setLock(kind: 'manual' | 'auto', held: boolean): void {
  if (held) locks.add(kind)
  else locks.delete(kind)
  if (locks.size) arm()
  else disarm()
}

export function setManualKeepAwakeHeld(held: boolean): void {
  setLock('manual', held)
}

/** Restarts the idle countdown, waking the panel first if we are dimmed. */
export function noteUserActivity(): void {
  const current = phase.getState()
  if (current === 'off') {
    // A level still held after the last lock went is a restore that failed.
    // A touch retries it without arming the dim again.
    if (capturedLevel !== null) enqueue(restore)
    return
  }
  activity++
  // A level still held while armed is a restore that failed, so a touch
  // tries it again.
  if (current === 'dimmed' || capturedLevel !== null) {
    phase.setState('armed')
    enqueue(restore)
  }
  startIdleTimer()
}

/** Puts the brightness back and stops dimming until a lock or lifecycle change. */
export function undimScreen(): void {
  disarm()
}

export function useScreenDimmed(): boolean {
  return phase.useValue((p) => p === 'dimmed')
}

export function isScreenDimmed(): boolean {
  return phase.getState() === 'dimmed'
}

async function recoverPersistedLevel(): Promise<void> {
  if (Platform.OS !== 'ios') return
  const raw = await app().storage.getItem(PERSISTED_LEVEL_KEY)
  if (raw === null) return

  const level = Number(raw)
  if (!Number.isFinite(level)) {
    await clearPersistedLevel()
    return
  }
  capturedLevel = level
  await restore()
}

export function initScreenDim(): void {
  if (teardowns.length === 0) {
    teardowns.push(
      subscribeAutoKeepAwake((held) => setLock('auto', held)),
      (() => {
        const sub = AppState.addEventListener('change', (next) =>
          next === 'active' ? arm() : disarm(),
        )
        return () => sub.remove()
      })(),
    )
  }
  setLock('auto', isAutoKeepAwakeHeld())
  enqueue(recoverPersistedLevel)
}

export function shutdownScreenDim(): void {
  disarm()
  for (const teardown of teardowns) teardown()
  teardowns.length = 0
}

export function __resetScreenDimForTesting(): void {
  clearIdleTimer()
  for (const teardown of teardowns) teardown()
  teardowns.length = 0
  locks.clear()
  brightnessQueue = Promise.resolve()
  capturedLevel = null
  activity = 0
  phase.setState('off')
}
