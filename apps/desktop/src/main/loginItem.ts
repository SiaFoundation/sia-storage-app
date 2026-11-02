/*
 * Opening the app at login.
 *
 * Quitting hides the Finder folder and stops the daemon this app started, and
 * macOS quits every app when it restarts, so after a restart the folder is
 * missing and nothing syncs until someone opens the app. As a login item the
 * app comes back on its own, and its startup brings both back.
 *
 * Electron's login item settings register the app bundle itself with
 * SMAppService on macOS 13 and later. The system owns the setting: it lists the
 * app under System Settings > General > Login Items, where the user can remove
 * it, so every read here asks the system rather than remembering an answer.
 *
 * Beta and shipping builds turn it on the first time they have an account. A
 * file in the app's support directory records that the choice has been made,
 * by that default or by the user, so the default never undoes a user's "off".
 * That directory belongs to the bundle, which keeps the four build contexts'
 * choices apart, and sign-out wipes only the library, so the choice and the
 * login item outlast signing out and back in.
 */

import { existsSync, writeFileSync } from 'node:fs'
import { log } from './log'

/** What the status window shows. `needs-approval` is a login item the user turned off in System Settings. */
export type LoginItemStatus = 'on' | 'off' | 'needs-approval'

/** Electron's `getLoginItemSettings().status` on macOS. */
export type SystemStatus = 'not-registered' | 'enabled' | 'requires-approval' | 'not-found'

export type LoginItemSystem = {
  status(): SystemStatus
  /** Registers or unregisters. Electron reports no result, so the caller reads `status` after. */
  set(on: boolean): void
  /** Opens System Settings at Login Items. */
  openSettings(): void
}

export type LoginItem = {
  status(): LoginItemStatus
  set(on: boolean): LoginItemStatus
  /**
   * Turns the login item on once, for a build that defaults to it, when this
   * Mac has an account. `hasAccount` is a daemon round trip, so it is asked
   * only while the default is still to apply.
   */
  applyDefault(hasAccount: () => Promise<boolean>): Promise<void>
}

/**
 * `not-found` reads as off: the system has no registration to report, and
 * turning the switch on is how to make one.
 */
export function toLoginItemStatus(status: SystemStatus): LoginItemStatus {
  if (status === 'enabled') return 'on'
  if (status === 'requires-approval') return 'needs-approval'
  return 'off'
}

/** dev and test builds launching at every login would get in the way of whoever is building them. */
export function enabledByDefault(variant: string): boolean {
  return variant === 'prod' || variant === 'beta'
}

export function createLoginItem(opts: {
  system: LoginItemSystem
  /** Whether `applyDefault` turns it on, from `enabledByDefault`. */
  enableByDefault: boolean
  /** Where the record of a made choice lives. */
  choiceFile: string
}): LoginItem {
  const { system, choiceFile } = opts
  const read = () => toLoginItemStatus(system.status())

  const recordChoice = () => {
    try {
      writeFileSync(choiceFile, '{"chosen":true}\n')
    } catch (e) {
      // Logged rather than thrown, because the switch has already moved. Left
      // unsaved, the default turns the login item back on at a later launch.
      log.error('login_item', 'choice_not_saved', { path: choiceFile, error: e as Error })
    }
  }

  return {
    status: read,

    set(on) {
      system.set(on)
      recordChoice()
      const status = read()
      // The system keeps a login item the user turned off in System Settings
      // off until it is allowed there, so that is where the switch sends them.
      if (on && status === 'needs-approval') system.openSettings()
      log.info('login_item', 'set', { requested: on, status })
      return status
    },

    async applyDefault(hasAccount) {
      if (!opts.enableByDefault || existsSync(choiceFile)) return
      // Checked again after the daemon answers, so a switch turned off while
      // waiting on it is not turned back on.
      if (!(await hasAccount()) || existsSync(choiceFile)) return
      if (read() === 'off') system.set(true)
      recordChoice()
      log.info('login_item', 'default_applied', { status: read() })
    },
  }
}
