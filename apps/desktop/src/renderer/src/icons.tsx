/*
 * Six inline icons, drawn rather than imported.
 *
 * A 16-unit viewBox rendered at 15px, stroked with currentColor so each takes
 * the colour of the text beside it.
 */

type Props = { className?: string }

const box = {
  width: 15,
  height: 15,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** Two stacked documents. */
export const DocOnDoc = ({ className }: Props) => (
  <svg {...box} className={className} aria-hidden="true">
    <rect x="2.2" y="1.8" width="8" height="10" rx="1.4" />
    <path d="M5.8 14.2h6a1.4 1.4 0 0 0 1.4-1.4V4.6" />
  </svg>
)

/** A drive, with its activity light. */
export const InternalDrive = ({ className }: Props) => (
  <svg {...box} className={className} aria-hidden="true">
    <rect x="1.6" y="3.4" width="12.8" height="9.2" rx="2" />
    <path d="M1.6 9.2h12.8" />
    <circle cx="11.6" cy="11" r="0.75" fill="currentColor" stroke="none" />
  </svg>
)

/** A clock face. */
export const Clock = ({ className }: Props) => (
  <svg {...box} className={className} aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 4.6V8l2.4 1.6" />
  </svg>
)

/** Two links of a chain. */
export const Link = ({ className }: Props) => (
  <svg {...box} className={className} aria-hidden="true">
    <path d="M6.6 9.4a2.6 2.6 0 0 0 3.8.2l2-2a2.6 2.6 0 0 0-3.7-3.7l-1 1" />
    <path d="M9.4 6.6a2.6 2.6 0 0 0-3.8-.2l-2 2a2.6 2.6 0 0 0 3.7 3.7l1-1" />
  </svg>
)

/** A checkmark in a circle. */
export const CheckCircle = ({ className }: Props) => (
  <svg {...box} className={className} aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" />
    <path d="M5.3 8.2 7.2 10l3.5-3.8" />
  </svg>
)

/** An exclamation mark in a circle. */
export const WarnCircle = ({ className }: Props) => (
  <svg {...box} className={className} aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 4.8v4" />
    <circle cx="8" cy="11" r="0.7" fill="currentColor" stroke="none" />
  </svg>
)

/** arrow.up.circle and arrow.down.circle */
export const ArrowCircle = ({ className, down }: Props & { down?: boolean }) => (
  <svg {...box} className={className} aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" />
    {down ? <path d="M8 5v6M5.6 8.6 8 11l2.4-2.4" /> : <path d="M8 11V5M5.6 7.4 8 5l2.4 2.4" />}
  </svg>
)

/** folder, doc.text and power, for the footer */
export const Folder = ({ className }: Props) => (
  <svg {...box} className={className} aria-hidden="true">
    <path d="M1.8 4.4A1.4 1.4 0 0 1 3.2 3h2.6l1.4 1.6h5.6a1.4 1.4 0 0 1 1.4 1.4v6a1.4 1.4 0 0 1-1.4 1.4H3.2a1.4 1.4 0 0 1-1.4-1.4z" />
  </svg>
)

export const DocText = ({ className }: Props) => (
  <svg {...box} className={className} aria-hidden="true">
    <path d="M3.4 2.4h6L12.6 5.6v8a1 1 0 0 1-1 1h-8.2a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" />
    <path d="M9.2 2.5v3.2h3.2M5 8.6h6M5 11h4" />
  </svg>
)

export const Power = ({ className }: Props) => (
  <svg {...box} className={className} aria-hidden="true">
    <path d="M8 2.2v5.4" />
    <path d="M11.6 4.4a5 5 0 1 1-7.2 0" />
  </svg>
)
