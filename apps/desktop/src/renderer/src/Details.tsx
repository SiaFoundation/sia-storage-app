/*
 * The status view, drawn in the window once this Mac has an account.
 *
 * The same status line, rows and sources as the popover, plus the rows the
 * popover has no room for: the average upload speed, the folder count, the
 * share links, the Finder folder and the name it goes by in the sidebar, and
 * the connection to the indexer.
 */

import { useApp } from '@siastorage/core/app'
import { useShareLinks, useTrashCount, useUploadSpeed } from '@siastorage/core/stores'
import { useState } from 'react'
import { Footer } from './Footer'
import { DoneMark, ROW, Row, Section } from './Group'
import {
  ArrowCircle,
  CheckCircle,
  DocOnDoc,
  Folder,
  Gauge,
  InternalDrive,
  Link,
  Lock,
  Trash,
  WarnCircle,
} from './icons'
import {
  connectionLabel,
  fileCountLabel,
  folderCountLabel,
  formatBitrate,
  formatBytes,
  indexerLabel,
  librarySizeLabel,
  localCacheLabel,
  metadataLabel,
  mountLabel,
  uploadsRow,
} from './model'
import { StatusLine } from './StatusLine'
import { UpdateNotice } from './UpdateNotice'
import { useAppInfo } from './useAppInfo'
import { useConfirm } from './useConfirm'
import { useLocalCache, useStatus } from './useStatus'

export function Details({
  onShowLinks,
  onShowTrash,
}: {
  onShowLinks: () => void
  onShowTrash: () => void
}) {
  const status = useStatus()
  const localCache = useLocalCache()
  const links = useShareLinks({ revalidateOnFocus: false })
  const trash = useTrashCount()
  const info = useAppInfo()
  // An average moves slowly, so a slow re-read keeps up with it.
  const speed = useUploadSpeed({ refreshInterval: 10_000 }).data ?? null

  const mounted = status.domain === 'mounted'
  // A build that cannot mount is not a mount that failed, so it does not warn.
  const mountable = status.domain !== 'unsupported'
  const online = status.daemonReachable && status.connected
  const uploads = uploadsRow(status)
  const [clearNotice, setClearNotice] = useState<Notice | null>(null)

  return (
    <div className="flex flex-col">
      {/* pt-12: the window has no title bar, so the traffic lights sit over the
          content, and the inset keeps the first thing drawn from landing under them. */}
      <div className="flex flex-col gap-3 px-inset pt-12 pb-[18px]">
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
          <Row
            icon={<InternalDrive />}
            label="On this Mac"
            id="on-this-mac"
            value={localCacheLabel(localCache)}
          />
          <ClearLocalFiles bytes={localCache.bytes} onDone={setClearNotice} />
          <button
            type="button"
            className={`${ROW} w-full cursor-default border-none bg-transparent text-left text-label [font-family:inherit] enabled:hover:bg-divider`}
            onClick={onShowTrash}
          >
            <span className="flex w-[15px] shrink-0 text-secondary">
              <Trash />
            </span>
            <span className="flex-auto">Trash</span>
            <span data-testid="trash" className="pr-row-x text-secondary tabular-nums">
              {trash.data !== undefined ? trash.data.toLocaleString() : '-'}
            </span>
          </button>
        </Section>
        {clearNotice ? (
          <p
            data-testid="clear-notice"
            className={`m-0 -mt-1 text-[11px] leading-[1.5] ${clearNotice.error ? 'text-red' : 'text-secondary'}`}
          >
            {clearNotice.text}
          </p>
        ) : null}

        <Section header="Sharing">
          <button
            type="button"
            className={`${ROW} w-full cursor-default border-none bg-transparent text-left text-label [font-family:inherit] enabled:hover:bg-divider`}
            onClick={onShowLinks}
          >
            <span className="flex w-[15px] shrink-0 text-secondary">
              <Link />
            </span>
            <span className="flex-auto">Share links</span>
            <span data-testid="share-links" className="pr-row-x text-secondary tabular-nums">
              {links.data ? links.data.length.toLocaleString() : '-'}
            </span>
          </button>
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

type Notice = { text: string; error: boolean }

/**
 * Clear Local Files, as mobile has under Settings. It removes this Mac's copy
 * of every file already uploaded, and takes a second click, as Empty Trash
 * does. A file Finder has downloaded keeps its Finder copy, which on APFS
 * shares its blocks with ours, so that space frees only once Finder drops its
 * copy too.
 */
function ClearLocalFiles({
  bytes,
  onDone,
}: {
  bytes: number | null
  onDone: (notice: Notice | null) => void
}) {
  const app = useApp()
  const [confirming, setConfirming] = useConfirm()
  const [clearing, setClearing] = useState(false)

  const clear = async () => {
    setClearing(true)
    onDone(null)
    try {
      const result = await app.cache.clear()
      onDone({
        text: `Removed ${formatBytes(result?.bytesFreed ?? 0)} from this Mac. Files downloaded in Finder keep using space until you choose Remove Download there.`,
        error: false,
      })
    } catch {
      onDone({ text: 'Could not clear local files. Try again.', error: true })
    } finally {
      setClearing(false)
    }
  }

  return (
    <button
      type="button"
      data-testid="clear-local-files"
      className={`${ROW} w-full cursor-default border-none bg-transparent text-left [font-family:inherit] enabled:hover:bg-divider ${confirming ? 'text-red' : 'text-accent'}`}
      disabled={clearing}
      onClick={() => {
        if (!confirming) return setConfirming(true)
        setConfirming(false)
        void clear()
      }}
    >
      <span className="w-[15px] shrink-0" />
      <span className="flex flex-auto flex-col gap-px">
        {clearing
          ? 'Clearing…'
          : confirming
            ? `Remove up to ${formatBytes(bytes ?? 0)} from this Mac`
            : 'Clear Local Files'}
        <span className="text-[11px] leading-[1.4] text-pretty text-secondary">
          Removes files on this Mac that are already backed up. Files that aren't backed up yet are
          kept.
        </span>
      </span>
    </button>
  )
}
