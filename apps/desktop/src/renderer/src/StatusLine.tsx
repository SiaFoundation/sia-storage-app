/*
 * The one line that says what the app is doing, in the popover and the window.
 *
 * It is always there and always the same height while things are working, so
 * a sync or an upload starting changes the words and not the layout. A second
 * line appears only for a state that has stopped and needs its reason seen: a
 * daemon that is down, a connection that failed, a folder that is not in
 * Finder. Pointing at the line gives the longer account of any state.
 */

import { CheckCircle, Spinner, WarnCircle } from './icons'
import {
  activity,
  activityDetail,
  activityHelp,
  activityHint,
  activityProgress,
  indicator,
  type Status,
  working,
} from './model'

const TONE = {
  green: 'text-green',
  orange: 'text-orange',
  red: 'text-red',
  accent: 'text-accent',
} as const

/** The delay each of the three dots starts its fade at, a sixth of the 1.2s cycle apart. */
const DOT_DELAY = ['[animation-delay:0ms]', '[animation-delay:200ms]', '[animation-delay:400ms]']

export function StatusLine({ status }: { status: Status }) {
  const colour = indicator(status)
  const busy = working(status)
  const detail = activityDetail(status)
  const hint = activityHint(status)
  const progress = activityProgress(status)

  return (
    // polite: the line changes on its own, and a transfer starting is not
    // worth interrupting whatever a screen reader is in the middle of.
    <div
      role="status"
      aria-live="polite"
      title={activityHelp(status)}
      className="relative overflow-hidden rounded-card bg-card px-row-x py-[9px]"
    >
      <div className="flex items-center gap-2">
        {/* A check when all is well, a spinner while something is under way,
            a warning when something has stopped. Read from the same decision
            as the words, so the two cannot disagree. */}
        <span aria-hidden className={`flex w-[15px] shrink-0 justify-center ${TONE[colour]}`}>
          {busy ? (
            <Spinner className="animate-spin" />
          ) : colour === 'green' ? (
            <CheckCircle />
          ) : (
            <WarnCircle />
          )}
        </span>
        <p className="m-0 min-w-0 flex-auto truncate text-[13px] font-semibold">
          <span data-testid="status-message">{activity(status)}</span>
          {busy ? (
            <span aria-hidden>
              {DOT_DELAY.map((delay) => (
                <span key={delay} className={`animate-dot ${delay}`}>
                  .
                </span>
              ))}
            </span>
          ) : null}
        </p>
        {hint ? (
          <span
            data-testid="status-hint"
            className="shrink-0 pr-row-x text-[11px] text-secondary tabular-nums"
          >
            {hint}
          </span>
        ) : null}
      </div>
      {detail ? (
        <p
          data-testid="status-detail"
          className="mx-0 mt-0.5 mb-0 pl-[23px] text-[11px] leading-[1.4] text-pretty text-secondary"
        >
          {detail}
        </p>
      ) : null}
      {/* Laid over the card's bottom edge rather than given a row, so a state
          with a measure and one without are the same height. */}
      <div
        aria-hidden
        className={`absolute inset-x-0 bottom-0 h-[2px] bg-divider transition-opacity duration-300 ${
          progress === null ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div
          className="h-full origin-left bg-accent transition-transform duration-500 ease-settle"
          style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress ?? 0))})` }}
        />
      </div>
    </div>
  )
}
