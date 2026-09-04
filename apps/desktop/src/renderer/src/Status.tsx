/*
 * The status view, drawn in the menu bar popover.
 *
 * Every value comes from a hook that refreshes itself; nothing here polls.
 */

import { useEffect, useRef } from 'react'
import { sia } from './api'
import {
  ArrowCircle,
  CheckCircle,
  Clock,
  DocOnDoc,
  DocText,
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
  useStatus,
} from './model'

function Section({ header, children }: { header: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="section-header">{header}</h2>
      <div className="card">{children}</div>
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
    <div className="row">
      <span className={tone ? `row-icon ${tone}` : 'row-icon'}>{icon}</span>
      <span className="row-label">
        {label}
        {description ? <span className="row-description">{description}</span> : null}
      </span>
      <span className={truncateMiddle ? 'row-value truncate-middle' : 'row-value'}>{value}</span>
    </div>
  )
}

export function Status() {
  const status = useStatus()
  const root = useRef<HTMLDivElement>(null)

  // The window is only as tall as what it shows, so the transfer section
  // appearing and disappearing does not leave a gap. Observed rather than
  // measured once, because rows come and go with state.
  useEffect(() => {
    const element = root.current
    if (!element) return
    const report = () => sia.reportHeight(element.getBoundingClientRect().height)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const mounted = status.domain === 'mounted'
  const detail = activityDetail(status)

  return (
    <div className="status-root" ref={root}>
      <header className="status-header">
        <span className={`dot ${indicator(status)}${transferInFlight(status) ? ' pulsing' : ''}`} />
        <div>
          <p className="activity">{activity(status)}</p>
          {detail ? <p className="activity-detail">{detail}</p> : null}
        </div>
      </header>

      <div className="sections">
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
            <div className="row progress-row">
              <progress max={1} value={transferProgress(status)} />
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
          <Row
            icon={<Link />}
            label="Indexer"
            value={indexerLabel(status) || 'Not connected'}
            truncateMiddle
          />
          <Row
            icon={mounted ? <CheckCircle /> : <WarnCircle />}
            label="Finder"
            value={mountLabel(status)}
            tone={mounted ? 'green' : 'orange'}
          />
        </Section>
      </div>

      <footer className="footer">
        <button type="button" onClick={() => void sia.openMount()} disabled={!status.mountPath}>
          <Folder />
          Open Folder
        </button>
        <button type="button" onClick={() => void sia.openLogs()}>
          <DocText />
          Logs
        </button>
        <button type="button" className="quit" onClick={() => void sia.quit()}>
          <Power />
          Quit
        </button>
      </footer>
    </div>
  )
}
