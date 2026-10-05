/*
 * Sign-in, shown in the window when this Mac has no account.
 *
 * Two screens. The first asks the indexer for a connection, which the user
 * approves in a browser. The indexer's answer says whether the approving
 * account already uses Sia Storage, and that picks what the second screen
 * opens on: the grid to enter that account's recovery phrase, or a newly
 * generated phrase to save. Either can be switched for the other.
 *
 * A generated phrase is the only copy, so it will not continue until you say
 * you wrote it down. Approval can take minutes, so every step is named on
 * screen. A surface that only spins reads as a hang.
 */

import { useApp } from '@siastorage/core/app'
import { useEffect, useRef, useState } from 'react'
import { PLAIN_BUTTON, PRIMARY_BUTTON } from './buttons'
import { PhotoPile } from './onboarding/PhotoPile'
import { HEADING, LEAD, Shell } from './onboarding/Shell'
import { type Checked, checkFor, emptySlots, isComplete, splitPhrase, toPhrase } from './phrase'
import { PhraseGrid } from './PhraseGrid'
import {
  cancelPairing,
  checkPhrase,
  DAEMON_DOWN,
  generateRecoveryPhrase,
  INVALID_PHRASE,
  NO_MATCH,
  type PairingStep,
  type PhraseCheck,
  register,
  requestApproval,
  safeMessage,
  UNVERIFIED,
} from './pairing'
import { Wordmark } from './Wordmark'

const PROGRESS: Record<PairingStep, string> = {
  idle: '',
  requesting: 'Asking the indexer for a connection',
  'awaiting-approval': 'Waiting for you to approve in your browser',
  registering: 'Setting up this Mac',
  done: '',
}

const CHECK_PROBLEM: Partial<Record<PhraseCheck, string>> = {
  invalid: INVALID_PHRASE,
  'no-match': NO_MATCH,
  unverified: UNVERIFIED,
  unreachable: DAEMON_DOWN,
}

const COPIED_MS = 2000
const CHECK_DELAY_MS = 250

const LINK =
  'cursor-default border-none bg-transparent p-0 text-[11px] text-secondary underline ' +
  '[font-family:inherit] enabled:hover:text-label disabled:opacity-45'

export function SignIn({ onDone }: { onDone: () => void }) {
  const app = useApp()
  const [stage, setStage] = useState<'connect' | 'phrase'>('connect')
  /** Whether the account that approved already uses this app. Set by the approval. */
  const [reconnecting, setReconnecting] = useState(false)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [generated, setGenerated] = useState<string[] | null>(null)
  const [entered, setEntered] = useState<string[]>(emptySlots)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [step, setStep] = useState<PairingStep>('idle')
  const [checked, setChecked] = useState<Checked<PhraseCheck>>({ phrase: '', result: 'idle' })
  const [error, setError] = useState<string | null>(null)

  const busy = step !== 'idle' && step !== 'done'
  // Cancelling cannot stop the run in flight, only the daemon call it is
  // waiting on, so its outcome is discarded rather than moving the form on.
  const attempt = useRef(0)

  useEffect(() => {
    generateRecoveryPhrase(app)
      .then((phrase) => setGenerated(splitPhrase(phrase)))
      .catch((e: Error) => setError(safeMessage(e)))
  }, [app])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  // The checksum is what a full grid of real words can still get wrong, so it
  // is asked about the moment the last slot fills rather than at Continue.
  useEffect(() => {
    if (stage !== 'phrase' || mode !== 'existing' || !isComplete(entered)) {
      setChecked({ phrase: '', result: 'idle' })
      return
    }
    const phrase = toPhrase(entered)
    let live = true
    // Held a moment: replacing a full phrase word by word changes the grid
    // twelve times, and each check of a reconnecting account asks the indexer.
    const timer = setTimeout(() => {
      void checkPhrase(app, phrase, { mustMatch: reconnecting }).then((result) => {
        if (live) setChecked({ phrase, result })
      })
    }, CHECK_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [app, stage, mode, entered, reconnecting])

  const slots = mode === 'new' ? (generated ?? emptySlots()) : entered
  const check = checkFor<PhraseCheck>(checked, entered, 'idle')
  const ready = mode === 'new' ? generated !== null && saved : check === 'ok'
  const problem = error ?? (stage === 'phrase' ? (CHECK_PROBLEM[check] ?? null) : null)

  async function connect() {
    const ticket = ++attempt.current
    setError(null)
    // Busy from the first line: a second click before the first step is
    // reported would start a second request.
    setStep('requesting')
    try {
      const answer = await requestApproval(app, setStep)
      if (ticket !== attempt.current) return
      setReconnecting(answer.reconnecting)
      setMode(answer.reconnecting ? 'existing' : 'new')
      setStage('phrase')
      setStep('idle')
    } catch (e) {
      if (ticket !== attempt.current) return
      setStep('idle')
      setError(safeMessage(e))
    }
  }

  async function submit() {
    setError(null)
    setStep('registering')
    try {
      await register(app, toPhrase(slots), setStep)
      onDone()
    } catch (e) {
      setStep('idle')
      setError(safeMessage(e))
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(toPhrase(slots))
      setCopied(true)
    } catch {
      setError('Could not copy the phrase. Select it and copy by hand.')
    }
  }

  function switchMode(next: 'new' | 'existing') {
    setMode(next)
    setError(null)
  }

  if (stage === 'connect') {
    return (
      <Shell stage={<PhotoPile mode="preview" />}>
        <Wordmark />

        <div className="mt-7">
          <h1 className={HEADING}>Private storage, right in Finder</h1>
          <p className={LEAD}>
            Sia Storage encrypts your files on this Mac and keeps them on the Sia network, where
            only you can read them. To begin, approve this Mac in your browser.
          </p>
        </div>

        <div className="mt-4 flex min-h-[32px] flex-col gap-1.5">
          {problem ? <p className="m-0 text-[11px] text-red">{problem}</p> : null}
          {busy ? <p className="m-0 text-[11px] text-secondary">{PROGRESS[step]}</p> : null}
        </div>

        <div className="mt-auto flex justify-end">
          {step === 'awaiting-approval' ? (
            // Only while waiting for the browser: builder.cancel() aborts that
            // wait and nothing else, so before the request is out a cancel
            // would return the form while the daemon keeps going.
            <button
              type="button"
              className={PLAIN_BUTTON}
              disabled={cancelling}
              onClick={() => {
                if (cancelling) return
                setCancelling(true)
                attempt.current++
                // The form stays busy until the daemon-side cancel lands: a
                // retry started before it could have its own approval wait
                // aborted by this one.
                void cancelPairing(app).finally(() => {
                  setCancelling(false)
                  setStep('idle')
                })
              }}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={busy}
              onClick={() => void connect()}
            >
              Connect
            </button>
          )}
        </div>
      </Shell>
    )
  }

  return (
    <Shell
      stage={<PhotoPile mode="encrypted" />}
      caption="Without these twelve words, this is all there is to see. They are stored with you and nowhere else."
    >
      <div>
        <h1 className={HEADING}>
          {mode === 'new'
            ? 'Your recovery phrase'
            : reconnecting
              ? 'Welcome back'
              : 'Enter your recovery phrase'}
        </h1>
        <p className={LEAD}>
          {mode === 'new'
            ? reconnecting
              ? 'This starts a new library with no files in it. Save the phrase somewhere safe. It cannot be recovered if lost.'
              : 'This is the key to your account. Save it somewhere safe. It cannot be recovered if lost.'
            : reconnecting
              ? 'This account already uses Sia Storage. Enter its twelve word recovery phrase to bring your library to this Mac.'
              : 'Enter the twelve word recovery phrase for the account you want on this Mac.'}
        </p>
      </div>

      <form
        className="mt-4 flex flex-auto flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready && !busy) void submit()
        }}
      >
        <PhraseGrid slots={slots} onChange={setEntered} readOnly={mode === 'new'} disabled={busy} />

        {mode === 'new' ? (
          <>
            <div className="flex items-center gap-2.5">
              {/* Until the phrase arrives there is nothing to copy or to have
                  written down, and copying the empty grid reports success. */}
              <button
                type="button"
                className={PLAIN_BUTTON}
                onClick={() => void copy()}
                disabled={busy || generated === null}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
              <label className="flex items-center gap-1.5 text-[11px] leading-[1.3] text-secondary">
                <input
                  className="m-0 shrink-0 accent-accent"
                  type="checkbox"
                  checked={saved}
                  disabled={busy || generated === null}
                  onChange={(event) => setSaved(event.target.checked)}
                />
                I have written this down somewhere safe
              </label>
            </div>
            <button
              type="button"
              className={`${LINK} self-start`}
              disabled={busy}
              onClick={() => switchMode('existing')}
            >
              {reconnecting
                ? 'Enter my recovery phrase instead'
                : 'Already have a recovery phrase?'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={`${LINK} self-start`}
            disabled={busy}
            onClick={() => switchMode('new')}
          >
            {reconnecting
              ? 'Start a new library instead'
              : 'Use the phrase generated for this Mac instead'}
          </button>
        )}

        {problem ? <p className="m-0 text-[11px] text-red">{problem}</p> : null}
        {busy ? <p className="m-0 text-[11px] text-secondary">{PROGRESS[step]}</p> : null}

        <div className="mt-auto flex items-center justify-between">
          {/* The approved request is held in the daemon's memory, so a daemon
              that restarted has lost it and registering fails. A new request
              is the way out. */}
          <button
            type="button"
            className={LINK}
            disabled={busy}
            onClick={() => {
              setStage('connect')
              setError(null)
            }}
          >
            Start over
          </button>
          <button type="submit" className={PRIMARY_BUTTON} disabled={!ready || busy}>
            Continue
          </button>
        </div>
      </form>
    </Shell>
  )
}
