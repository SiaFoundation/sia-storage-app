/*
 * The status view, drawn in the window once this Mac has an account.
 *
 * The same status line, rows and sources as the popover, plus the rows the
 * popover has no room for: the average upload speed, the folder count, the
 * share links, the Finder folder and the name it goes by in the sidebar, the
 * switch for opening at login, and the connection to the indexer.
 */

import { useApp } from '@siastorage/core/app'
import { useShareLinks, useTrashCount, useUploadSpeed } from '@siastorage/core/stores'
import { useEffect, useState } from 'react'
import { Footer } from './Footer'
import { DoneMark, ROW, Row, Section, SubRow } from './Group'
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
  localCacheBreakdown,
  localCacheLabel,
  metadataLabel,
  mountLabel,
  uploadsRow,
} from './model'
import { OpenAtLogin } from './OpenAtLogin'
import { StatusLine } from './StatusLine'
import { UpdateNotice } from './UpdateNotice'
import { useAppInfo } from './useAppInfo'
import { useConfirm } from './useConfirm'
import { useClearState, useLocalCache, useStatus } from './useStatus'

export function Details({
  onShowLinks,
  onShowTrash,
}: {
  onShowLinks: () => void
  onShowTrash: () => void
}) {
  const status = useStatus()
  const clearState = useClearState()
  const localCache = useLocalCache(clearState.data?.running ? 1_000 : 30_000)
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
          {localCacheBreakdown(localCache).map((line) => (
            <SubRow key={line.id} id={line.id} label={line.label} value={line.value} />
          ))}
          <ClearLocalFiles bytes={localCache.bytes} state={clearState} onDone={setClearNotice} />
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

        <OpenAtLogin />

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
 * Clear Local Files, as mobile has under Settings, behind a second click as
 * Empty Trash is. It removes every uploaded file's copy from this computer:
 * the daemon deletes its own, and has Finder drop the ones Finder holds. A
 * file open in another app keeps Finder's copy.
 *
 * Finder takes a moment per file, so a clear can run for minutes. It runs in
 * the daemon, and this row reads its state, so the clear carries on while the
 * window closes, and a window opened meanwhile shows it running.
 */
function ClearLocalFiles({
  bytes,
  state,
  onDone,
}: {
  bytes: number | null
  state: ReturnType<typeof useClearState>
  onDone: (notice: Notice | null) => void
}) {
  const app = useApp()
  const [confirming, setConfirming] = useConfirm()
  // The finished count when this window started a clear. The first read
  // after that with no clear running ends the wait, and the clear was this
  // window's when the count moved past it. A daemon that restarted mid-clear
  // starts its count again and reads as a failed clear.
  const [finishedBefore, setFinishedBefore] = useState<number | null>(null)
  const clearing = finishedBefore !== null || (state.data?.running ?? false)

  useEffect(() => {
    if (finishedBefore === null || !state.data || state.data.running) return
    setFinishedBefore(null)
    const freed = state.data.finished > finishedBefore ? state.data.lastBytesFreed : null
    onDone(
      freed === null
        ? { text: 'Could not clear local files. Try again.', error: true }
        : { text: `Removed ${formatBytes(freed)} from this Mac.`, error: false },
    )
  }, [finishedBefore, state.data, onDone])

  const clear = async () => {
    onDone(null)
    try {
      const started = await app.cache.startClear()
      // The returned state shows the clear running, so the wait above holds
      // until a later read shows it ended.
      void state.mutate(started)
      setFinishedBefore(started.finished)
    } catch {
      onDone({ text: 'Could not clear local files. Try again.', error: true })
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
