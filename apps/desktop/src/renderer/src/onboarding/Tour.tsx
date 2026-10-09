/*
 * The tour: a few slides on what Sia Storage does with a file and where the
 * files are, shown while setup runs behind it.
 *
 * It is here to be read or skipped. Setup does not wait on it, and its
 * progress sits in the corner the whole way, so leaving early costs nothing
 * and staying to the end is never what holds the library up.
 */

import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { sia } from '../api'
import { PLAIN_BUTTON, PRIMARY_BUTTON } from '../buttons'
import type { SetupStep } from '../model'
import { FinderMock } from './FinderMock'
import { PhoneMock } from './PhoneMock'
import { PhotoPile } from './PhotoPile'
import { Providers } from './Providers'
import { SetupChip } from './SetupChip'
import { ShardField } from './ShardField'
import { HEADING, LEAD, Shell } from './Shell'
import { moved, type SlideId, slides } from './slides'

const LINK =
  'cursor-default border-none bg-transparent p-0 text-[11px] text-secondary underline ' +
  '[font-family:inherit] hover:text-label'

/** The mobile app's store pages. */
const APP_STORE_URL = 'https://apps.apple.com/app/id6753593109'
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=sia.storage'

/**
 * The way from the phone slide to the phone: a code for the App Store, and a
 * link for Android. One code, since two side by side leave the reader to work
 * out which is theirs before they can scan either.
 */
function InstallApp() {
  return (
    <div className="mt-5 flex items-center gap-3.5">
      {/* The code keeps its white ground and margin on the dark window, which
          a phone's camera needs around a code to find it. */}
      <QRCodeSVG
        data-testid="tour-install-code"
        value={APP_STORE_URL}
        size={88}
        marginSize={2}
        title="Code for Sia Storage on the App Store"
        className="shrink-0 rounded-[6px]"
      />
      <div className="flex flex-col items-start gap-1">
        <span data-testid="tour-install-label" className="text-[12px] font-semibold text-label">
          Scan to install the companion app
        </span>
        <span className="text-[11px] text-secondary">Opens the App Store on an iPhone.</span>
        <button
          type="button"
          className={LINK}
          // A browser that will not open leaves nothing to say on this slide.
          onClick={() => void sia.openUrl(PLAY_STORE_URL).catch(() => {})}
        >
          On Android, get it on Google Play
        </button>
      </div>
    </div>
  )
}

function Stage({ id, finderName }: { id: SlideId; finderName: string }) {
  /** The pointer is over the picture, which each slide answers in its own way. */
  const [pointed, setPointed] = useState(false)
  const watch = {
    onPointerEnter: () => setPointed(true),
    onPointerLeave: () => setPointed(false),
  }
  switch (id) {
    case 'encrypt':
      return <PhotoPile mode="encrypt" />
    case 'split':
      return (
        <div {...watch} className="p-4">
          <ShardField spare={pointed} />
        </div>
      )
    case 'distribute':
      return (
        <div {...watch}>
          <Providers offline={pointed} />
        </div>
      )
    case 'finder':
      return <FinderMock finderName={finderName} />
    case 'phone':
      return <PhoneMock />
  }
}

export function Tour({
  steps,
  finderName,
  onLeave,
}: {
  /** Setup as it stands, for the corner. */
  steps: SetupStep[]
  finderName: string
  /** The tour is over, by its last slide, by Skip, or by the corner. */
  onLeave: () => void
}) {
  const all = slides(finderName)
  const [index, setIndex] = useState(0)
  const slide = all[index] as (typeof all)[number]
  const last = index === all.length - 1

  // The arrow keys turn the slides, as they do in anything laid out as pages.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') setIndex((at) => moved(at, 1, all.length))
      if (event.key === 'ArrowLeft') setIndex((at) => moved(at, -1, all.length))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [all.length])

  return (
    <Shell
      // Keyed by slide, so each picture is built new and plays its arrival.
      stage={
        <div key={slide.id} className="flex animate-rise items-center justify-center">
          <Stage id={slide.id} finderName={finderName} />
        </div>
      }
      caption={
        <span key={slide.id} className="block animate-rise [animation-delay:120ms]">
          {slide.caption}
        </span>
      }
      corner={<SetupChip steps={steps} onOpen={onLeave} />}
    >
      {/* Centred in the column, level with the picture it describes. */}
      <div key={slide.id} className="my-auto animate-rise">
        <p
          data-testid="tour-step"
          className="mx-0 mt-0 mb-2.5 text-[11px] font-semibold tracking-[0.04em] text-secondary uppercase tabular-nums"
        >
          {(index + 1).toLocaleString()} of {all.length.toLocaleString()}
        </p>
        <h1 data-testid="tour-title" className={HEADING}>
          {slide.title}
        </h1>
        <p className={LEAD}>{slide.body}</p>
        {slide.id === 'phone' ? <InstallApp /> : null}
      </div>

      <div className="flex items-center gap-2">
        {/* One dot per slide, the current one drawn long. A fixed width, so
            the dots trading places mid-transition do not nudge what follows. */}
        <div className="flex w-[56px] shrink-0 items-center gap-[5px]" aria-hidden>
          {all.map((each, at) => (
            <span
              key={each.id}
              className={`h-[5px] rounded-full transition-[width,background-color] duration-300 ease-settle ${
                at === index ? 'w-4 bg-label' : 'w-[5px] bg-divider'
              }`}
            />
          ))}
        </div>
        <button type="button" className={`${LINK} ml-3`} onClick={onLeave}>
          Skip
        </button>
        <div className="ml-auto flex gap-2">
          {index > 0 ? (
            <button
              type="button"
              className={PLAIN_BUTTON}
              onClick={() => setIndex(moved(index, -1, all.length))}
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            className={PRIMARY_BUTTON}
            onClick={() => (last ? onLeave() : setIndex(moved(index, 1, all.length)))}
          >
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </Shell>
  )
}
