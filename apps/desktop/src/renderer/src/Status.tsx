/*
 * The status view, drawn in the menu bar popover.
 *
 * Every value comes from a hook that refreshes itself, apart from the mount
 * state, which `useStatus` polls while a mount is settling. The indexer and
 * the Finder folder have no rows of their own here: the status line names
 * either one when it is the problem. The window shows the same status with
 * more rows, and the footer opens it.
 */

import { Footer } from './Footer'
import { DoneMark, Row, Section } from './Group'
import { useReportedHeight } from './height'
import { ArrowCircle, DocOnDoc, InternalDrive, Lock } from './icons'
import { fileCountLabel, librarySizeLabel, metadataLabel, uploadsRow } from './model'
import { StatusLine } from './StatusLine'
import { useStatus } from './useStatus'

export function Status() {
  const status = useStatus()
  const root = useReportedHeight<HTMLDivElement>()

  const uploads = uploadsRow(status)

  return (
    // No min-height: this element is what reportHeight measures, so flooring it
    // at the viewport would let the popover grow and never shrink back.
    <div className="flex flex-col" ref={root}>
      <div className="flex flex-col gap-3 px-inset pt-inset pb-[18px]">
        <StatusLine status={status} />

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
          <Row icon={<InternalDrive />} label="Size" id="size" value={librarySizeLabel(status)} />
        </Section>
      </div>

      <Footer status={status} surface="popover" />
    </div>
  )
}
