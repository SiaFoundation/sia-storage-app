/*
 * The status view, drawn in the window once this Mac has an account.
 *
 * The same status line, rows and sources as the popover, plus the rows the
 * popover has no room for: the average upload speed, the folder count, the
 * Finder folder and the name it goes by in the sidebar, and the connection to
 * the indexer.
 */

import { useUploadSpeed } from '@siastorage/core/stores'
import { Footer } from './Footer'
import { DoneMark, Row, Section } from './Group'
import {
  ArrowCircle,
  CheckCircle,
  DocOnDoc,
  Folder,
  Gauge,
  InternalDrive,
  Link,
  Lock,
  WarnCircle,
} from './icons'
import {
  connectionLabel,
  fileCountLabel,
  folderCountLabel,
  formatBitrate,
  indexerLabel,
  librarySizeLabel,
  metadataLabel,
  mountLabel,
  uploadsRow,
} from './model'
import { StatusLine } from './StatusLine'
import { useAppInfo } from './useAppInfo'
import { useStatus } from './useStatus'

export function Details() {
  const status = useStatus()
  const info = useAppInfo()
  // An average moves slowly, so a slow re-read keeps up with it.
  const speed = useUploadSpeed({ refreshInterval: 10_000 }).data ?? null

  const mounted = status.domain === 'mounted'
  // A build that cannot mount is not a mount that failed, so it does not warn.
  const mountable = status.domain !== 'unsupported'
  const online = status.daemonReachable && status.connected
  const uploads = uploadsRow(status)

  return (
    <div className="flex flex-col">
      {/* pt-12: the window has no title bar, so the traffic lights sit over the
          content, and the inset keeps the first thing drawn from landing under them. */}
      <div className="flex flex-col gap-3 px-inset pt-12 pb-[18px]">
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
          {/* On the wire, parity included, which is the figure a connection is
              rated in. */}
          {speed ? (
            <Row
              icon={<Gauge />}
              label="Average upload speed"
              id="upload-speed"
              value={formatBitrate(speed.rawBps)}
            />
          ) : null}
        </Section>

        <Section header="Library">
          <Row icon={<DocOnDoc />} label="Files" id="files" value={fileCountLabel(status)} />
          <Row icon={<Folder />} label="Folders" id="folders" value={folderCountLabel(status)} />
          <Row icon={<InternalDrive />} label="Size" id="size" value={librarySizeLabel(status)} />
        </Section>

        <Section header="Finder">
          <Row
            icon={!mountable ? <Folder /> : mounted ? <CheckCircle /> : <WarnCircle />}
            label="Folder"
            id="finder"
            value={mountLabel(status)}
            tone={mounted ? 'green' : mountable ? 'orange' : undefined}
          />
          {mountable && info ? (
            <Row
              icon={<Folder />}
              label="Name in the sidebar"
              id="finder-name"
              value={info.finderName}
            />
          ) : null}
        </Section>

        <Section header="Connection">
          <Row
            icon={<Link />}
            label="Indexer"
            id="indexer"
            value={indexerLabel(status)}
            truncateMiddle
          />
          <Row
            icon={online ? <CheckCircle /> : <WarnCircle />}
            label="Status"
            id="connection"
            value={connectionLabel(status)}
            tone={online ? 'green' : 'orange'}
          />
        </Section>
      </div>

      <Footer status={status} surface="window" version={info?.version} />
    </div>
  )
}
