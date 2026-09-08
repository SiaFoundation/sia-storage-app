/*
 * Sign-in, shown in the window when this Mac has no account.
 *
 * The same two ways in as mobile, in the same order: a phrase is generated and
 * shown for saving, and someone who has one switches over to enter it. A
 * generated phrase is the only copy, so it will not continue until you say you
 * wrote it down. Approval happens in a browser and can take minutes, so every
 * step is named on screen; a surface that only spins reads as a hang.
 */

import { useApp } from '@siastorage/core/app'
import { useEffect, useRef, useState } from 'react'
import wordmark from './assets/sia-storage-dark.png'
import { emptySlots, isComplete, splitPhrase, toPhrase } from './phrase'
import { PhraseGrid } from './PhraseGrid'
import {
  cancelPairing,
  checkPhrase,
  DAEMON_DOWN,
  generateRecoveryPhrase,
  INVALID_PHRASE,
  pair,
  type PairingStep,
  safeMessage,
} from './pairing'

const PROGRESS: Record<PairingStep, string> = {
  idle: '',
  requesting: 'Asking the indexer for a connection',
  'awaiting-approval': 'Waiting for you to approve in your browser',
  registering: 'Setting up this Mac',
  done: '',
}

const COPIED_MS = 2000

const BUTTON =
  'cursor-default rounded-md border px-3 py-[3px] text-[12px] [font-family:inherit] ' +
  'focus-visible:shadow-[0_0_0_3px_rgb(10_132_255/40%)] focus-visible:outline-none disabled:opacity-45'
const PLAIN_BUTTON = `${BUTTON} border-divider bg-card text-label enabled:hover:bg-divider`
const PRIMARY_BUTTON = `${BUTTON} border-transparent bg-accent text-white enabled:hover:brightness-110`
const LINK =
  'cursor-default self-start border-none bg-transparent p-0 text-[11px] text-secondary underline ' +
  '[font-family:inherit] enabled:hover:text-label disabled:opacity-45'

export function SignIn({ onDone }: { onDone: () => void }) {
  const app = useApp()
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [generated, setGenerated] = useState<string[] | null>(null)
  const [entered, setEntered] = useState<string[]>(emptySlots)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [step, setStep] = useState<PairingStep>('idle')
  const [check, setCheck] = useState<'idle' | 'ok' | 'invalid' | 'unreachable'>('idle')
  const [error, setError] = useState<string | null>(null)

  const busy = step !== 'idle' && step !== 'done'
  // Cancelling cannot stop the run in flight, only the daemon call it is
  // waiting on, so its outcome is discarded rather than signing the user in.
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
    if (mode !== 'existing' || !isComplete(entered)) {
      setCheck('idle')
      return
    }
    let live = true
    void checkPhrase(app, toPhrase(entered)).then((result) => {
      if (live) setCheck(result)
    })
    return () => {
      live = false
    }
  }, [app, mode, entered])

  const slots = mode === 'new' ? (generated ?? emptySlots()) : entered
  const ready = mode === 'new' ? generated !== null && saved : check === 'ok'
  const problem =
    error ?? (check === 'invalid' ? INVALID_PHRASE : check === 'unreachable' ? DAEMON_DOWN : null)

  async function submit() {
    const ticket = ++attempt.current
    setError(null)
    // Busy from the first line: pair() checks the phrase before it reports a
    // step, and a second click in that window would start a second pairing.
    setStep('requesting')
    try {
      await pair(app, toPhrase(slots), setStep)
      if (ticket === attempt.current) onDone()
    } catch (e) {
      if (ticket !== attempt.current) return
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

  return (
    // pt-12: the window has no title bar, so the traffic lights sit over the
    // content, and the inset keeps the first thing drawn from landing under them.
    <div className="flex flex-col gap-3.5 px-inset pt-12 pb-inset">
      {/* Drawn white with coloured accents for a dark background. Inverting it
          alone would flip the accents too, so the hue is rotated back and only
          the lightness changes. */}
      <img
        className="h-auto w-[132px] [@media(prefers-color-scheme:light)]:[filter:invert(1)_hue-rotate(180deg)]"
        src={wordmark}
        alt="sia.storage"
      />

      <div>
        <h1 className="m-0 text-[15px] font-semibold">
          {mode === 'new' ? 'Your recovery phrase' : 'Welcome back'}
        </h1>
        <p className="mx-0 mt-1 mb-0 text-[11px] leading-[1.45] text-secondary">
          {mode === 'new'
            ? 'This is the key to your account. Save it somewhere safe. It cannot be recovered if lost.'
            : 'Enter the twelve word recovery phrase for the account you want on this Mac.'}
        </p>
      </div>

      <form
        className="flex flex-col gap-3"
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
              className={LINK}
              disabled={busy}
              onClick={() => {
                setMode('existing')
                setError(null)
              }}
            >
              Already have a recovery phrase?
            </button>
          </>
        ) : (
          <button
            type="button"
            className={LINK}
            disabled={busy}
            onClick={() => {
              setMode('new')
              setError(null)
            }}
          >
            Use the phrase generated for this Mac instead
          </button>
        )}

        {problem ? <p className="m-0 text-[11px] text-red">{problem}</p> : null}
        {busy ? <p className="m-0 text-[11px] text-secondary">{PROGRESS[step]}</p> : null}

        <div className="flex justify-end">
          {step === 'awaiting-approval' ? (
            // Only while waiting for the browser: builder.cancel() aborts that
            // wait and nothing else, so during create and register a cancel
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
            <button type="submit" className={PRIMARY_BUTTON} disabled={!ready || busy}>
              Continue
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
