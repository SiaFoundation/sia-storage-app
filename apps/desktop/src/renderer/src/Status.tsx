/*
 * The menu bar popover: the status view, and a second tab listing the files
 * added most recently.
 *
 * Every value comes from a hook that refreshes itself, apart from the mount
 * state, which `useStatus` polls while a mount is settling. The indexer and
 * the Finder folder have no rows of their own here: the status line names
 * either one when it is the problem. The window shows the same status with
 * more rows, and the footer opens it.
 */

import { useState } from 'react'
import { Activity } from './Activity'
import { Footer } from './Footer'
import { DoneMark, Row, Section } from './Group'
import { useReportedHeight } from './height'
import { ArrowCircle, DocOnDoc, InternalDrive, Lock } from './icons'
import { fileCountLabel, librarySizeLabel, metadataLabel, uploadsRow } from './model'
import { StatusLine } from './StatusLine'
import { UpdateNotice } from './UpdateNotice'
import { useStatus } from './useStatus'

type Tab = 'status' | 'activity'

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'status', label: 'Status' },
  { id: 'activity', label: 'Activity' },
]

export function Status() {
  const status = useStatus()
  const root = useReportedHeight<HTMLDivElement>()
  // Kept while the popover is hidden, so it opens on the tab it closed on.
  const [tab, setTab] = useState<Tab>('status')

  const uploads = uploadsRow(status)

  return (
    // No min-height: this element is what reportHeight measures, so flooring it
    // at the viewport would let the popover grow and never shrink back.
    <div className="flex flex-col" ref={root}>
      <div className="flex flex-col gap-3 px-inset pt-inset pb-[18px]">
        <Tabs value={tab} onChange={setTab} />
        {tab === 'activity' ? (
          <Activity canReveal={Boolean(status.mountPath)} />
        ) : (
          <>
            <StatusLine status={status} />
            <UpdateNotice />

            <Section header="Activity">
              <Row
                icon={<ArrowCircle />}
                label="Uploads"
                id="uploads"
                value={uploads.label}
                valueIcon={uploads.done ? <DoneMark /> : undefined}
              />
              <Row
                icon={<Lock />}
                label="Encrypted metadata"
                id="metadata"
                value={metadataLabel(status)}
              />
            </Section>

            <Section header="Library">
              <Row icon={<DocOnDoc />} label="Files" id="files" value={fileCountLabel(status)} />
              <Row
                icon={<InternalDrive />}
                label="Size"
                id="size"
                value={librarySizeLabel(status)}
              />
            </Section>
          </>
        )}
      </div>

      <Footer status={status} surface="popover" />
    </div>
  )
}

/** The two tabs, as a segmented control across the top, keyed like a native tab bar. */
function Tabs({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  return (
    <div role="tablist" aria-label="Popover" className="flex gap-px rounded-[7px] bg-card p-0.5">
      {TABS.map((t, i) => {
        const chosen = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={chosen}
            tabIndex={chosen ? 0 : -1}
            className={`flex-1 cursor-default rounded-[5px] border-none py-[3px] text-[12px] outline-none [font-family:inherit] transition-[background-color,color] duration-150 ease-settle focus-visible:shadow-[0_0_0_2px_var(--color-accent)] ${
              chosen
                ? 'bg-divider font-medium text-label'
                : 'bg-transparent text-secondary hover:text-label'
            }`}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length]
              onChange(next.id)
              document.getElementById(`tab-${next.id}`)?.focus()
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
