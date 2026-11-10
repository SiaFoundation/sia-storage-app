/*
 * The popover's activity tab: the files added most recently, newest first,
 * each with when it was added, and with its upload's progress while it is
 * still on its way to Sia.
 *
 * Clicking a row selects the file in Finder. Pointing at it swaps its status
 * mark for a link button, which makes a share link for the file and copies it
 * in one click, with the settings chosen behind the chevron beside it. Those
 * start as this version of the file and no expiry, and are kept for every
 * link after.
 */

import { useApp } from '@siastorage/core/app'
import { expiresAt, shareErrorText } from '@siastorage/core/lib/shareLinkText'
import { useRecentFiles } from '@siastorage/core/stores'
import type { RecentFile } from '@siastorage/core/types'
import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import {
  activityLabel,
  splitName,
  type FileActivity,
  fileActivity,
  loadQuickShare,
  QUICK_EXPIRY_CHOICES,
  QUICK_MODE_CHOICES,
  type QuickShare,
  rowDetail,
  saveQuickShare,
} from './activityModel'
import { sia } from './api'
import { PRIMARY_BUTTON } from './buttons'
import { FileIcon } from './FileIcon'
import { ROW, ROW_LAYOUT, Section } from './Group'
import { CheckCircle, ChevronDown, Clock, Link, ProgressRing, WarnCircle } from './icons'
import { ScrollArea } from './ScrollArea'
import { useNow } from './useNow'
import { terms } from './terms'

/** How many files the list holds. Older ones are in Finder. */
const RECENT_LIMIT = 30

const ICON_BUTTON =
  'flex h-[22px] cursor-default items-center justify-center rounded-[5px] border-none bg-transparent p-0 outline-none ' +
  'transition-[scale,background-color,color] duration-150 ease-settle enabled:active:scale-[0.92] ' +
  'enabled:hover:bg-divider enabled:hover:text-label focus-visible:shadow-[0_0_0_2px_var(--color-accent)] disabled:opacity-40'

/**
 * The rows are a list of things to click, drawn the way AppKit's inset table
 * style draws one: no lines between rows, and a rounded highlight inset from
 * the card's edges. Lines between rows belong to the status groups, whose
 * rows are not clickable and never highlight.
 */
const HIGHLIGHT = 'absolute inset-x-1 inset-y-0 rounded-[5px]'

type ShareState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'copied' }
  | { kind: 'failed'; text: string }

export function Activity({ canReveal }: { canReveal: boolean }) {
  const app = useApp()
  const recent = useRecentFiles(RECENT_LIMIT)
  // The same key the status view reads, so both share one copy of the
  // uploader's state, refreshed at most once a second while it works.
  const uploads = useSWR(app.caches.uploads.key('active'), () => app.uploads.getState()).data
  const now = useNow()
  const [quick, setQuick] = useState(() => loadQuickShare(localStorage))
  const [optionsFor, setOptionsFor] = useState<string | null>(null)

  const changeQuick = (next: QuickShare) => {
    setQuick(next)
    saveQuickShare(localStorage, next)
  }

  const files = recent.data ?? []
  return (
    <Section>
      {files.length === 0 ? (
        <div className={`${ROW} text-secondary`} data-testid="activity-empty">
          {recent.data ? 'Files you add appear here.' : 'Loading…'}
        </div>
      ) : (
        <ScrollArea className="max-h-[352px] overflow-y-auto py-1" testId="activity-list">
          {files.map((file) => (
            <ActivityRow
              key={file.id}
              file={file}
              activity={fileActivity(file, uploads?.uploads[file.id])}
              now={now}
              canReveal={canReveal}
              quick={quick}
              onQuickChange={changeQuick}
              optionsOpen={optionsFor === file.id}
              onToggleOptions={() => setOptionsFor((open) => (open === file.id ? null : file.id))}
            />
          ))}
        </ScrollArea>
      )}
    </Section>
  )
}

function ActivityRow({
  file,
  activity,
  now,
  canReveal,
  quick,
  onQuickChange,
  optionsOpen,
  onToggleOptions,
}: {
  file: RecentFile
  activity: FileActivity
  now: number
  canReveal: boolean
  quick: QuickShare
  onQuickChange: (next: QuickShare) => void
  optionsOpen: boolean
  onToggleOptions: () => void
}) {
  const app = useApp()
  const [share, setShare] = useState<ShareState>({ kind: 'idle' })
  useEffect(() => {
    if (share.kind !== 'copied' && share.kind !== 'failed') return
    const timer = setTimeout(
      () => setShare({ kind: 'idle' }),
      share.kind === 'copied' ? 2_000 : 4_000,
    )
    return () => clearTimeout(timer)
  }, [share])

  const makeLink = async (choice: QuickShare) => {
    if (share.kind === 'working') return
    setShare({ kind: 'working' })
    try {
      const link = await app.shares.createLink([file.id], {
        expiresAt: expiresAt(choice.expiry, Date.now()),
        mode: choice.mode,
      })
      await sia.copyText(link.url)
      setShare({ kind: 'copied' })
    } catch (e) {
      setShare({ kind: 'failed', text: shareErrorText(e, 'Could not make the link.') })
    }
  }

  const reveal = () => {
    if (canReveal) void sia.revealFile(file.id)
  }

  // A link attaches a file once it has an object on the network, and an
  // unavailable file has no bytes left to upload, so its link would stay empty.
  const canShare = activity.kind !== 'unavailable'
  // Held on screen while a link is being made, just made, or being set up,
  // so the result shows where the click was even after the pointer leaves.
  const pinned = share.kind !== 'idle' || optionsOpen
  const shareSetting = `${QUICK_MODE_CHOICES.find((c) => c.id === quick.mode)?.label.toLowerCase()}, ${expiryText(quick.expiry).toLowerCase()}`

  return (
    <div
      className="group/item relative"
      data-file-id={file.id}
      title={file.folder ? `${file.folder}/${file.name}` : file.name}
    >
      <span
        aria-hidden
        className={`pointer-events-none ${HIGHLIGHT} bg-card transition-opacity duration-150 ${
          optionsOpen ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'
        }`}
      />
      <div className={`${ROW_LAYOUT} relative`}>
        {/* The whole row is the Finder button. It lies under the row's text,
            which passes clicks through to it, and the share buttons sit above
            it, so they stay separate targets rather than nested buttons. */}
        <button
          type="button"
          className={`${HIGHLIGHT} cursor-default border-none bg-transparent p-0 outline-none transition-colors duration-150 enabled:active:bg-card focus-visible:shadow-[0_0_0_2px_var(--color-accent)]`}
          aria-label={`Show ${file.name} in ${terms.fileManager}`}
          disabled={!canReveal}
          onClick={reveal}
        />
        <span className="pointer-events-none relative flex shrink-0">
          <FileIcon id={file.id} name={file.name} type={file.type} />
        </span>
        {/* Always rendered, so VoiceOver announces the result when the text
            changes. The visible line below is a new element each time. */}
        <span role="status" className="sr-only">
          {share.kind === 'copied' ? 'Link copied' : share.kind === 'failed' ? share.text : ''}
        </span>
        <span className="pointer-events-none relative flex min-w-0 flex-auto flex-col gap-px">
          <FileName name={file.name} />
          <Subtitle
            share={share}
            activity={activity}
            detail={rowDetail(activity, file.addedAt, now)}
          />
        </span>
        {/* The mark and the actions share one slot and swap by opacity, not
            display, so the buttons stay in the tab order and a keyboard focus
            on one is what brings them up. The mark is centred in a box the
            width of the chevron button, so the chevron takes its place in the
            same column on hover. */}
        <span className="relative flex w-[46px] shrink-0 items-center justify-end">
          <span
            className={`pointer-events-none absolute right-0 flex w-[22px] justify-center transition-opacity duration-150 ${
              pinned ? 'opacity-0' : 'group-focus-within/item:opacity-0 group-hover/item:opacity-0'
            }`}
            role="img"
            aria-label={activityLabel(activity)}
          >
            <ActivityMark activity={activity} />
          </span>
          <span
            className={`flex items-center gap-0.5 transition-opacity duration-150 ${
              pinned
                ? 'opacity-100'
                : 'opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100'
            }`}
          >
            <button
              type="button"
              className={`${ICON_BUTTON} w-[22px] ${share.kind === 'copied' ? 'text-green' : 'text-secondary'}`}
              aria-label={`Copy a share link for ${file.name}`}
              title={`Copy share link (${shareSetting})`}
              disabled={!canShare}
              onClick={() => void makeLink(quick)}
            >
              {share.kind === 'working' ? (
                <ProgressRing progress={null} />
              ) : share.kind === 'copied' ? (
                <CheckCircle />
              ) : (
                <Link />
              )}
            </button>
            <button
              type="button"
              className={`${ICON_BUTTON} w-[22px] ${optionsOpen ? 'text-label' : 'text-secondary'}`}
              aria-label={`Share link options for ${file.name}`}
              aria-expanded={optionsOpen}
              title="Share link options"
              disabled={!canShare}
              onClick={onToggleOptions}
            >
              <ChevronDown
                className={`h-[11px] w-[11px] transition-transform duration-150 ease-settle ${
                  optionsOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
          </span>
        </span>
      </div>
      {optionsOpen && canShare ? (
        <ShareOptions
          quick={quick}
          onChange={onQuickChange}
          working={share.kind === 'working'}
          onCreate={() => {
            onToggleOptions()
            void makeLink(quick)
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * The name cut in the middle when it does not fit, as Finder cuts it, so the
 * extension stays readable. Only the part before the extension shrinks.
 */
function FileName({ name }: { name: string }) {
  const { stem, ext } = splitName(name)
  return (
    <span className="flex min-w-0">
      <span data-testid="activity-file" className="sr-only">
        {name}
      </span>
      <span aria-hidden className="truncate">
        {stem}
      </span>
      {ext ? (
        <span aria-hidden className="shrink-0">
          {ext}
        </span>
      ) : null}
    </span>
  )
}

function Subtitle({
  share,
  activity,
  detail,
}: {
  share: ShareState
  activity: FileActivity
  detail: string
}) {
  const base = 'truncate text-[11px] leading-[1.4]'
  if (share.kind === 'copied')
    return (
      <span data-testid="activity-share" className={`${base} text-green`}>
        Link copied
      </span>
    )
  if (share.kind === 'failed')
    return (
      <span data-testid="activity-share" className={`${base} text-red`}>
        {share.text}
      </span>
    )
  return (
    <span
      data-testid="activity-status"
      className={`${base} tabular-nums ${activity.kind === 'failed' ? 'text-red' : 'text-secondary'}`}
    >
      {share.kind === 'working' ? 'Making link…' : detail}
    </span>
  )
}

/** The mark a row shows while the pointer is elsewhere. */
function ActivityMark({ activity }: { activity: FileActivity }) {
  switch (activity.kind) {
    case 'uploaded':
      return <CheckCircle className="text-secondary opacity-60" />
    case 'uploading':
      return <ProgressRing progress={activity.progress} className="text-accent" />
    case 'preparing':
      return <ProgressRing progress={null} className="text-accent" />
    case 'waiting':
      return <Clock className="text-secondary" />
    case 'failed':
      return <WarnCircle className="text-red" />
    case 'unavailable':
      return <WarnCircle className="text-orange" />
  }
}

function expiryText(expiry: QuickShare['expiry']): string {
  return expiry === 'never'
    ? 'Never expires'
    : `Expires in ${QUICK_EXPIRY_CHOICES.find((c) => c.id === expiry)?.label}`
}

/** What the next link shows and how long it lasts, under the row it is for. */
function ShareOptions({
  quick,
  onChange,
  working,
  onCreate,
}: {
  quick: QuickShare
  onChange: (next: QuickShare) => void
  working: boolean
  onCreate: () => void
}) {
  return (
    <div
      className="relative flex flex-col gap-1.5 pr-row-x pb-2.5 pl-[52px]"
      data-testid="share-options"
    >
      <Segmented
        label="Link shows"
        choices={QUICK_MODE_CHOICES}
        value={quick.mode}
        onChange={(mode) => onChange({ ...quick, mode })}
      />
      <Segmented
        label="Link expires"
        choices={QUICK_EXPIRY_CHOICES}
        value={quick.expiry}
        onChange={(expiry) => onChange({ ...quick, expiry })}
      />
      <div className="flex items-center gap-2 pt-0.5">
        {/* The expiry control's segments are bare durations, so this line is
            what says they set when the link expires. */}
        <span className="min-w-0 flex-auto truncate text-[11px] text-secondary">
          {expiryText(quick.expiry)}
        </span>
        <button
          type="button"
          className={`${PRIMARY_BUTTON} shrink-0 px-2.5 py-px text-[11px]`}
          disabled={working}
          onClick={onCreate}
        >
          Copy Link
        </button>
      </div>
    </div>
  )
}

/**
 * A compact segmented control that keys like a native radio group: one tab
 * stop on the chosen segment, and the arrow keys move the choice and the focus
 * together.
 */
function Segmented<C extends { id: string; label: string }>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string
  choices: readonly C[]
  value: C['id']
  onChange: (id: C['id']) => void
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const move = (from: number, step: number) => {
    const next = (from + step + choices.length) % choices.length
    onChange(choices[next].id)
    buttons.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-px rounded-[6px] bg-card p-px">
      {choices.map((choice, i) => {
        const chosen = choice.id === value
        return (
          <button
            key={choice.id}
            ref={(el) => {
              buttons.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={chosen ? 0 : -1}
            className={`flex-1 cursor-default rounded-[5px] border-none px-1 py-[2px] text-[11px] whitespace-nowrap outline-none [font-family:inherit] focus-visible:shadow-[0_0_0_2px_var(--color-accent)] ${
              chosen ? 'bg-divider text-label' : 'bg-transparent text-secondary hover:text-label'
            }`}
            onClick={() => onChange(choice.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(i, 1)
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(i, -1)
              else return
              e.preventDefault()
            }}
          >
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}
