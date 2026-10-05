/*
 * Setup, in the corner of the tour.
 *
 * Setup runs while the tour is read, and this is the one line of it that
 * matters at a glance: what it is doing now, or that it has finished.
 * Clicking it leaves the tour for the full list.
 */

import { CheckCircle, Spinner, WarnCircle } from '../icons'
import { setupFailed, setupFinished, type SetupStep } from '../model'

/** The step to name: the first one not finished, or the last when all are. */
function current(steps: SetupStep[]): SetupStep | undefined {
  return (
    steps.find((step) => step.state === 'failed') ??
    steps.find((step) => step.state === 'active') ??
    steps.find((step) => step.state === 'waiting') ??
    steps.at(-1)
  )
}

export function SetupChip({ steps, onOpen }: { steps: SetupStep[]; onOpen: () => void }) {
  const finished = setupFinished(steps)
  const failed = setupFailed(steps)
  const step = current(steps)
  const label = finished ? 'Ready' : failed ? 'Setup has stopped' : (step?.label ?? 'Setting up')

  return (
    <button
      type="button"
      data-testid="setup-chip"
      onClick={onOpen}
      title="Show setup"
      className="flex cursor-default items-center gap-1.5 rounded-full border-none bg-menu py-[5px] pr-2.5 pl-[7px] text-[11px] text-label shadow-[0_0_0_1px_var(--color-divider),0_4px_12px_rgb(0_0_0/18%)] [font-family:inherit] transition-[scale] duration-150 ease-settle focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.96]"
    >
      <span
        className={`flex ${finished ? 'text-green' : failed ? 'text-red' : 'text-accent'}`}
        aria-hidden
      >
        {finished ? (
          <CheckCircle />
        ) : failed ? (
          <WarnCircle />
        ) : (
          <Spinner className="animate-spin" />
        )}
      </span>
      <span data-testid="setup-chip-label">{label}</span>
      {!finished && !failed && step?.hint ? (
        <span className="text-secondary tabular-nums">{step.hint}</span>
      ) : null}
    </button>
  )
}
