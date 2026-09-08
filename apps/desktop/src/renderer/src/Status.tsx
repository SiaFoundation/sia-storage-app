/*
 * The status view, drawn in the menu bar popover.
 *
 * Every value comes from a hook that refreshes itself, apart from the mount
 * state, which `useStatus` polls while a mount is settling.
 */

import { sia } from './api'
import { useReportedHeight } from './height'
import {
  ArrowCircle,
  CheckCircle,
  Clock,
  DocOnDoc,
  Ellipsis,
  Folder,
  InternalDrive,
  Link,
  Power,
  WarnCircle,
} from './icons'
import {
  activity,
  activityDetail,
  fileCountLabel,
  indexerLabel,
  indicator,
  librarySizeLabel,
  mountLabel,
  transferCount,
  transferInFlight,
  transferLabel,
  transferProgress,
} from './model'
import { useStatus } from './useStatus'

const TONE_TEXT = { green: 'text-green', orange: 'text-orange', accent: 'text-accent' } as const
const DOT_BG = {
  green: 'bg-green',
  orange: 'bg-orange',
  red: 'bg-red',
  accent: 'bg-accent',
} as const

/**
 * The divider between rows is inset to the label column, but the row is not:
 * drawing it as a border would shift every row after the first out of
 * alignment with the one above, the tell of a hand-rolled inset group.
 */
const ROW =
  'relative flex min-h-[30px] items-center gap-2 px-row-x py-row-y ' +
  "before:absolute before:top-0 before:right-0 before:left-[35px] before:border-t before:border-divider before:content-[''] first:before:hidden"

const FOOTER_BUTTON =
  'flex cursor-default items-center gap-[5px] rounded-[5px] border-none bg-transparent py-[5px] text-[12px] text-label outline-none [font-family:inherit] ' +
  // Keyboard focus still needs to be visible; a mouse click should not ring.
  'enabled:hover:bg-card focus-visible:shadow-[0_0_0_2px_var(--color-accent)] disabled:text-secondary disabled:opacity-50'

function Section({ header, children }: { header: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mx-0 mt-0 mb-[5px] ml-0.5 text-[11px] font-semibold tracking-[0.04em] text-secondary uppercase">
        {header}
      </h2>
      <div className="overflow-hidden rounded-card bg-card">{children}</div>
    </section>
  )
}

function Row({
  icon,
  label,
  value,
  description,
  tone,
  truncateMiddle,
}: {
  icon: React.ReactNode
  label: string
  value: string
  description?: string
  tone?: 'green' | 'orange' | 'accent'
  truncateMiddle?: boolean
}) {
  return (
    <div className={ROW}>
      <span className={`flex w-[15px] shrink-0 ${tone ? TONE_TEXT[tone] : 'text-secondary'}`}>
        {icon}
      </span>
      <span className="flex flex-auto flex-col gap-px">
        {label}
        {description ? <span className="text-[11px] text-secondary">{description}</span> : null}
      </span>
      <span
        className={`shrink pr-row-x text-right text-secondary ${
          // rtl with an ellipsis keeps the host visible when a URL outgrows the row.
          truncateMiddle ? 'overflow-hidden text-ellipsis whitespace-nowrap [direction:rtl]' : ''
        }`}
      >
        {value}
      </span>
    </div>
  )
}

export function Status() {
  const status = useStatus()
  const root = useReportedHeight<HTMLDivElement>()

  const mounted = status.domain === 'mounted'
  // A build that cannot mount is not a mount that failed, so it does not warn.
  const mountable = status.domain !== 'unsupported'
  const detail = activityDetail(status)

  return (
    // No min-height: this element is what reportHeight measures, so flooring it
    // at the viewport would let the popover grow and never shrink back.
    <div className="flex flex-col" ref={root}>
      <header className="flex items-start gap-[9px] px-inset pt-inset">
        {/* Colour only: the text beside it already says what the dot means. */}
        <span
          aria-hidden
          className={`mt-[5px] size-2 shrink-0 rounded-full ${DOT_BG[indicator(status)]} ${
            // A halo only while something is in flight, so a steady state
            // never draws the eye.
            transferInFlight(status) ? 'animate-halo' : ''
          }`}
        />
        <div>
          <p className="m-0 text-[13px] font-semibold">{activity(status)}</p>
          {detail ? <p className="mx-0 mt-0.5 mb-0 text-[11px] text-secondary">{detail}</p> : null}
        </div>
      </header>

      <div className="flex flex-col gap-3 px-inset pt-3 pb-[18px]">
        {transferInFlight(status) ? (
          <Section header={transferLabel(status)}>
            {transferCount(status) ? (
              <Row
                icon={<ArrowCircle down={status.syncingDown} />}
                label="Progress"
                value={transferCount(status)}
                tone="accent"
              />
            ) : null}
            <div className={`${ROW} pt-0.5 pb-2.5`}>
              <progress
                className="mr-row-x h-1 w-full accent-accent"
                max={1}
                value={transferProgress(status)}
                aria-label={transferLabel(status)}
              />
            </div>
          </Section>
        ) : null}

        <Section header="Library">
          <Row icon={<DocOnDoc />} label="Files" value={fileCountLabel(status)} />
          <Row icon={<InternalDrive />} label="Size" value={librarySizeLabel(status)} />
          {status.uploadsPending > 0 ? (
            <Row
              icon={<Clock />}
              label="Waiting to upload"
              description="Queued until the uploader reaches them"
              value={String(status.uploadsPending)}
              tone="orange"
            />
          ) : null}
        </Section>

        <Section header="Connection">
          <Row icon={<Link />} label="Indexer" value={indexerLabel(status)} truncateMiddle />
          <Row
            icon={!mountable ? <Folder /> : mounted ? <CheckCircle /> : <WarnCircle />}
            label="Finder"
            value={mountLabel(status)}
            tone={mounted ? 'green' : mountable ? 'orange' : undefined}
          />
        </Section>
      </div>

      <footer className="mt-auto flex items-center gap-0.5 border-t border-divider px-2.5 pt-[9px] pb-2">
        <button
          type="button"
          className={`${FOOTER_BUTTON} px-2`}
          onClick={() => void sia.openMount()}
          disabled={!status.mountPath}
        >
          <Folder />
          Open Folder
        </button>
        {/* Square, because the glyph is the whole label. */}
        <button
          type="button"
          className={`${FOOTER_BUTTON} px-1.5`}
          aria-label="More"
          onClick={() => void sia.showMoreMenu()}
        >
          <Ellipsis />
        </button>
        {/* Pushed right, away from the actions that are safe to click by accident. */}
        <button
          type="button"
          className={`${FOOTER_BUTTON} px-2 ml-auto`}
          onClick={() => void sia.quit()}
        >
          <Power />
          Quit
        </button>
      </footer>
    </div>
  )
}
