/*
 * Setup, the last screen of onboarding, and the tour around it.
 *
 * Signing in leaves a connected account and nothing else: the library is still
 * empty and its folders are not in Finder yet. A large library takes a while
 * to sync, so the tour is shown over that wait with setup's progress in its
 * corner, and this screen lists each step with how far it has got.
 *
 * Nothing here drives the work. The daemon and the extension run the steps
 * whether or not this is on screen, which is why every screen can be left.
 */

import { useEffect, useState } from 'react'
import { sia } from './api'
import { PLAIN_BUTTON, PRIMARY_BUTTON } from './buttons'
import { ROW, TONE_TEXT } from './Group'
import { CheckCircle, Circle, DashCircle, Spinner, WarnCircle } from './icons'
import {
  awaitingFolderPass,
  setupFailed,
  setupFinished,
  type SetupStep,
  setupSteps,
  type StepState,
} from './model'
import { FinderMock } from './onboarding/FinderMock'
import { PhotoPile } from './onboarding/PhotoPile'
import { HEADING, LEAD, Shell } from './onboarding/Shell'
import { Tour } from './onboarding/Tour'
import { useAppInfo } from './useAppInfo'
import { useStatus } from './useStatus'

const LINK =
  'cursor-default border-none bg-transparent p-0 text-[11px] text-secondary underline ' +
  '[font-family:inherit] hover:text-label'

/**
 * How long setup waits for the extension to begin its pass over the folders.
 * The extension retries its folder listing four times, five seconds apart,
 * before it gives a pass up, so one that is coming has begun well inside this.
 */
const FOLDER_PASS_GRACE_MS = 45_000

const STEP_STATES: StepState[] = ['waiting', 'active', 'done', 'failed', 'skipped']

const STEP_TONE: Record<StepState, string> = {
  waiting: 'text-secondary opacity-60',
  active: TONE_TEXT.accent,
  done: TONE_TEXT.green,
  failed: TONE_TEXT.red,
  skipped: 'text-secondary',
}

function glyph(state: StepState, current: boolean) {
  switch (state) {
    case 'waiting':
      return <Circle />
    // Spun only while it is the one showing, so a finished list animates nothing.
    case 'active':
      return <Spinner className={current ? 'animate-spin' : ''} />
    case 'done':
      return <CheckCircle />
    case 'failed':
      return <WarnCircle />
    case 'skipped':
      return <DashCircle />
  }
}

/**
 * Every state's glyph is kept in the row and the current one is faded in over
 * the last. Swapping the element instead would cut from one to the next, and
 * a step finishing is the moment this screen exists to show.
 */
function StepIcon({ state }: { state: StepState }) {
  return (
    <span className="relative size-[15px] shrink-0">
      {STEP_STATES.map((each) => (
        <span
          key={each}
          className={`absolute inset-0 flex transition-[opacity,scale,filter] duration-300 ease-settle ${STEP_TONE[each]} ${
            each === state ? 'scale-100 opacity-100 blur-[0px]' : 'scale-25 opacity-0 blur-[4px]'
          }`}
        >
          {glyph(each, each === state)}
        </span>
      ))}
    </span>
  )
}

function Step({ step }: { step: SetupStep }) {
  return (
    <li className={ROW}>
      <StepIcon state={step.state} />
      <span className="flex min-w-0 flex-auto flex-col gap-px">
        <span
          data-testid={`step-${step.id}`}
          data-state={step.state}
          className={`transition-colors duration-300 ${step.state === 'waiting' ? 'text-secondary' : 'text-label'}`}
        >
          {step.label}
        </span>
        {step.detail ? (
          <span className="text-[11px] leading-[1.4] text-pretty text-red">{step.detail}</span>
        ) : null}
      </span>
      {step.hint ? (
        <span
          data-testid={`step-${step.id}-hint`}
          className="shrink-0 text-[11px] text-secondary tabular-nums"
        >
          {step.hint}
        </span>
      ) : null}
      {/* Over the row's bottom edge, from the label column on, so a step with
          a measure is no taller than one without. */}
      <span
        aria-hidden
        className={`absolute right-0 bottom-0 left-[35px] h-[2px] transition-opacity duration-300 ${
          step.progress === null ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <span
          className="block h-full origin-left bg-accent transition-transform duration-500 ease-settle"
          style={{ transform: `scaleX(${Math.min(1, Math.max(0, step.progress ?? 0))})` }}
        />
      </span>
    </li>
  )
}

/**
 * Everything after sign-in: the tour first, then the list of steps.
 *
 * One component for both, because both read the same setup, and reading it
 * here keeps the tour's corner and the list from ever disagreeing about it.
 */
export function Setup({ onDone }: { onDone: () => void }) {
  const [watching, setWatching] = useState(true)
  const status = useStatus({ watch: watching })
  const info = useAppInfo()
  // The name is per build, so the generic one stands in only until it arrives.
  const finderName = info?.finderName ?? 'Sia Storage'
  const [touring, setTouring] = useState(true)
  const [foldersOverdue, setFoldersOverdue] = useState(false)

  const steps = setupSteps(status, finderName, { foldersOverdue })
  // `awaitingFolderPass` is true while the folders step is active and the
  // extension has not begun its pass. FOLDER_PASS_GRACE_MS of that sets
  // `foldersOverdue`, and the pass beginning first cancels the timer.
  // `foldersOverdue` is never cleared: `foldersStep` reads it only while no
  // pass is running, so a pass that begins late still shows its progress.
  const awaiting = awaitingFolderPass(status, steps)
  useEffect(() => {
    if (!awaiting) return
    const timer = setTimeout(() => setFoldersOverdue(true), FOLDER_PASS_GRACE_MS)
    return () => clearTimeout(timer)
  }, [awaiting])

  const finished = setupFinished(steps)
  const failed = setupFailed(steps)
  // The watch polls the daemon every two seconds for as long as this screen
  // is mounted, which can be long after the last step has finished.
  useEffect(() => setWatching(!finished), [finished])
  const mountable = status.domain !== 'unsupported'

  if (touring) {
    return <Tour steps={steps} finderName={finderName} onLeave={() => setTouring(false)} />
  }

  return (
    <Shell
      stage={mountable ? <FinderMock finderName={finderName} /> : <PhotoPile mode="preview" />}
      caption={
        mountable
          ? `Sia Storage stays in the menu bar. Your files are under ${finderName} in Finder.`
          : 'This build runs without a Finder folder. The menu bar still shows the library.'
      }
    >
      <div className="animate-rise">
        <h1 data-testid="setup-heading" className={HEADING}>
          {finished ? 'Sia Storage is ready' : failed ? 'Setup has stopped' : 'Setting up this Mac'}
        </h1>
        <p className={LEAD}>
          {finished
            ? 'Your library is on this Mac. Sia Storage keeps it in sync from the menu bar.'
            : failed
              ? 'One step could not finish. The reason is under it.'
              : 'This happens once, and carries on if you close the window.'}
        </p>
      </div>

      {/* polite, and on the list rather than the rows: a step changing is read
          out once, not once per row that re-rendered beside it. */}
      <ol
        aria-live="polite"
        className="mx-0 mt-5 mb-0 animate-rise list-none overflow-hidden rounded-card bg-card p-0 [animation-delay:80ms]"
      >
        {steps.map((step) => (
          <Step key={step.id} step={step} />
        ))}
      </ol>

      <div className="mt-auto flex animate-rise items-center gap-2 [animation-delay:160ms]">
        <button type="button" className={LINK} onClick={() => setTouring(true)}>
          See the tour again
        </button>
        <div className="ml-auto flex gap-2">
          {mountable ? (
            <button
              type="button"
              className={PLAIN_BUTTON}
              disabled={!status.mountPath}
              onClick={() => void sia.openMount()}
            >
              Open in Finder
            </button>
          ) : null}
          <button
            type="button"
            className={finished ? PRIMARY_BUTTON : PLAIN_BUTTON}
            onClick={onDone}
          >
            {finished ? 'Done' : 'Continue'}
          </button>
        </div>
      </div>
    </Shell>
  )
}
