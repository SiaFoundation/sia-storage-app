/*
 * The status window's switch for opening the app at login.
 *
 * macOS keeps the setting, and the user can change it in System Settings while
 * this window is open, so it is read again each time the window comes forward.
 * A build with no app bundle to register, such as a run from source, gets no
 * answer and draws nothing.
 */

import { useCallback, useEffect, useId, useState } from 'react'
import { type LoginItemStatus, sia } from './api'
import { ROW, Section } from './Group'
import { Login } from './icons'
import { Switch } from './Switch'
import { terms } from './terms'

export function OpenAtLogin() {
  const [status, setStatus] = useState<LoginItemStatus | null>(null)
  // Set when the switch was turned on and the system reported it still off.
  const [refused, setRefused] = useState(false)
  const labelId = useId()
  const descriptionId = useId()

  const read = useCallback(() => {
    sia
      .loginItemStatus()
      .then(setStatus)
      .catch(() => {})
  }, [])

  useEffect(() => {
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [read])

  if (!status) return null

  const toggle = async (on: boolean) => {
    setRefused(false)
    // Moved ahead of the answer so the switch follows the click. Not for one
    // turned off in System Settings, which sends the user there and stays off.
    if (status !== 'needs-approval') setStatus(on ? 'on' : 'off')
    const next = await sia.setLoginItem(on).catch(() => null)
    if (next === null) return read()
    setStatus(next)
    setRefused(on && next === 'off')
  }

  const description = refused
    ? 'macOS did not add the app to Login Items.'
    : status === 'needs-approval'
      ? 'Turned off in System Settings, under General > Login Items.'
      : `Keeps the ${terms.fileManager} folder and syncing going after you restart.`

  return (
    <Section header="Startup">
      <div className={ROW}>
        <span className="flex w-[15px] shrink-0 text-secondary">
          <Login />
        </span>
        <span className="flex flex-auto flex-col gap-px">
          <span id={labelId}>Open at login</span>
          <span
            id={descriptionId}
            data-testid="open-at-login-description"
            className={`text-[11px] leading-[1.4] text-pretty ${refused ? 'text-orange' : 'text-secondary'}`}
          >
            {description}
          </span>
        </span>
        <span className="flex shrink-0 pr-row-x">
          <Switch
            checked={status === 'on'}
            onChange={(on) => void toggle(on)}
            labelledBy={labelId}
            describedBy={descriptionId}
            testId="open-at-login"
          />
        </span>
      </div>
    </Section>
  )
}
