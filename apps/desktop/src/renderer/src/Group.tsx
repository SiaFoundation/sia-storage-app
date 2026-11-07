/*
 * The inset group both windows are built from: a titled card of rows, each an
 * icon, a label and a value.
 */

import { CheckCircle } from './icons'

export const TONE_TEXT = {
  green: 'text-green',
  orange: 'text-orange',
  red: 'text-red',
  accent: 'text-accent',
} as const

export type Tone = keyof typeof TONE_TEXT

/**
 * The divider between rows is inset to the label column, but the row is not:
 * drawing it as a border would shift every row after the first out of
 * alignment with the one above, the tell of a hand-rolled inset group.
 */
export const ROW =
  'relative flex min-h-[30px] items-center gap-2 px-row-x py-row-y ' +
  "before:absolute before:top-0 before:right-0 before:left-[35px] before:border-t before:border-divider before:content-[''] first:before:hidden"

/** A green check, for a row whose value is that there is nothing left to do. */
export const DoneMark = () => (
  <span className="flex text-green">
    <CheckCircle />
  </span>
)

export function Section({ header, children }: { header?: string; children: React.ReactNode }) {
  return (
    <section>
      {header ? (
        <h2 className="mx-0 mt-0 mb-[5px] ml-0.5 text-[11px] font-semibold tracking-[0.04em] text-secondary uppercase">
          {header}
        </h2>
      ) : null}
      <div className="overflow-hidden rounded-card bg-card">{children}</div>
    </section>
  )
}

export function Row({
  icon,
  label,
  value,
  valueIcon,
  id,
  description,
  tone,
  truncateMiddle,
}: {
  icon: React.ReactNode
  label: string
  value?: string
  /** Drawn in place of the value's words, which stay there for a screen reader and a tooltip. */
  valueIcon?: React.ReactNode
  /** Names the value for a test, which reads it by this rather than by position. */
  id?: string
  description?: string
  tone?: Tone
  truncateMiddle?: boolean
}) {
  const shown =
    value === undefined ? null : valueIcon ? (
      <span title={value} className="flex shrink-0 pr-row-x">
        {valueIcon}
        <span data-testid={id} className="sr-only">
          {value}
        </span>
      </span>
    ) : (
      <span
        data-testid={id}
        className={`shrink pr-row-x text-right text-secondary tabular-nums ${
          // rtl with an ellipsis keeps the host visible when a URL outgrows the row.
          truncateMiddle ? 'overflow-hidden text-ellipsis whitespace-nowrap [direction:rtl]' : ''
        }`}
      >
        {value}
      </span>
    )
  return (
    <div className={ROW}>
      <span className={`flex w-[15px] shrink-0 ${tone ? TONE_TEXT[tone] : 'text-secondary'}`}>
        {icon}
      </span>
      {/* The description runs under the value as well as the label, so a long
          one wraps across the row instead of squeezing the value. */}
      <span className="flex min-w-0 flex-auto flex-col gap-px">
        <span className="flex items-center gap-2">
          <span className="flex-auto">{label}</span>
          {shown}
        </span>
        {description ? (
          <span className="pr-row-x text-[11px] leading-[1.4] text-pretty text-secondary">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  )
}
