/*
 * Share links, in the window.
 *
 * Opened two ways. Finder's Share Link action hands over the files selected
 * there, and the view asks what the link should show and how long it should
 * last before making it, because the indexer fixes both when the link is made.
 * The status view opens it with no files, to see and revoke the links already
 * made.
 */

import { useApp } from '@siastorage/core/app'
import {
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  type ExpiryChoice,
  expiresAt,
  expiryLabel,
  linkProgress,
  linkTitle,
  MODE_CHOICES,
  modeLabel,
  shareErrorText,
} from '@siastorage/core/lib/shareLinkText'
import { useShareLinks } from '@siastorage/core/stores'
import type { ShareLink, ShareLinkMode } from '@siastorage/core/types'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { sia } from './api'
import { PLAIN_BUTTON, PRIMARY_BUTTON } from './buttons'
import { FinderItemIcon } from './finderIcons'
import { ROW, Section } from './Group'
import { CheckCircle, Circle, Link } from './icons'
import { formatBytes } from './model'
import { folderName, groupByFolder } from './shareModel'
import { useAppInfo } from './useAppInfo'

const SMALL_BUTTON =
  'cursor-default rounded-[5px] border-none bg-transparent px-1.5 py-[2px] text-[12px] [font-family:inherit] ' +
  'transition-[scale,background-color] duration-150 ease-settle enabled:active:scale-[0.96] enabled:hover:bg-divider ' +
  'focus-visible:shadow-[0_0_0_2px_var(--color-accent)] focus-visible:outline-none'

type SharedFile = { fileId: string; name: string; size: number; folder: string | null }

/** The files as Finder shows them: each folder with its icon, and its files under it. */
function SharedFiles({ files }: { files: SharedFile[] }) {
  // The name the top of the library goes by in Finder differs per build.
  const libraryName = useAppInfo()?.finderName ?? 'Sia Storage'
  return (
    <div className="flex flex-col gap-1">
      {groupByFolder(files).map((group) => (
        <div key={group.folder ?? ''} className="flex flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1.5" title={group.folder ?? libraryName}>
            <FinderItemIcon folder />
            <span data-testid="share-folder" className="truncate text-[12px] text-secondary">
              {folderName(group.folder, libraryName)}
            </span>
          </span>
          {group.files.map((file) => (
            <span key={file.fileId} className="flex min-w-0 items-center gap-1.5 pl-[22px]">
              <FinderItemIcon folder={false} />
              <span data-testid="share-file" className="min-w-0 flex-auto truncate">
                {file.name}
              </span>
              <span className="shrink-0 text-[11px] text-secondary tabular-nums">
                {formatBytes(file.size)}
              </span>
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Copies to the clipboard and says so for a moment. */
function useCopied(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 1_500)
    return () => clearTimeout(timer)
  }, [copied])
  return [
    copied,
    (key, text) => {
      void sia.copyText(text)
      setCopied(key)
    },
  ]
}

function LinkRow({
  link,
  copied,
  onCopy,
}: {
  link: ShareLink
  copied: boolean
  onCopy: () => void
}) {
  const app = useApp()
  const [confirming, setConfirming] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const progress = linkProgress(link)

  // A second click confirms. The first only arms it, and arming expires, so a
  // stray click on a list of links cannot end one.
  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), 3_000)
    return () => clearTimeout(timer)
  }, [confirming])

  return (
    <div className={ROW} data-public-key={link.publicKey}>
      <span className="flex w-[15px] shrink-0 text-secondary">
        <Link />
      </span>
      <span className="flex min-w-0 flex-auto flex-col gap-px">
        <span data-testid="share-link" className="truncate">
          {linkTitle(link)}
        </span>
        <span className="text-[11px] leading-[1.4] text-secondary">
          {[modeLabel(link.mode), expiryLabel(link.expiresAt, Date.now()), progress]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {error ? <span className="text-[11px] leading-[1.4] text-red">{error}</span> : null}
      </span>
      <span className="flex shrink-0 gap-0.5 pr-1">
        <button type="button" className={`${SMALL_BUTTON} text-accent`} onClick={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className={`${SMALL_BUTTON} ${confirming ? 'text-red' : 'text-secondary'}`}
          disabled={revoking}
          onClick={() => {
            if (revoking) return
            if (!confirming) return setConfirming(true)
            setRevoking(true)
            setError(null)
            app.shares
              .revokeLink(link.publicKey)
              .catch((e) => setError(shareErrorText(e, 'Could not revoke the link. Try again.')))
              .finally(() => setRevoking(false))
          }}
        >
          {confirming ? 'Revoke link' : 'Revoke'}
        </button>
      </span>
    </div>
  )
}

/** The files Finder asked to share, and the choices of what the link shows and how long it lasts. */
function NewLink({
  fileIds,
  onCreated,
}: {
  fileIds: string[]
  onCreated: (link: ShareLink) => void
}) {
  const app = useApp()
  const [expiry, setExpiry] = useState<ExpiryChoice>(DEFAULT_EXPIRY)
  const [mode, setMode] = useState<ShareLinkMode>('latest')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Not reread when the window regains focus: each read is two daemon round
  // trips, and nothing about the chosen files changes while this is open.
  const files = useSWR(
    ['share-request', ...fileIds],
    async () => {
      const [rows, folders] = await Promise.all([
        app.files.getByIds(fileIds),
        app.directories.getPathsForFiles(fileIds),
      ])
      return rows.map((row) => ({
        fileId: row.id,
        name: row.name,
        size: row.size,
        folder: folders[row.id] ?? null,
      }))
    },
    { revalidateOnFocus: false },
  )

  async function create() {
    setCreating(true)
    setError(null)
    try {
      onCreated(
        await app.shares.createLink(fileIds, { expiresAt: expiresAt(expiry, Date.now()), mode }),
      )
    } catch (e) {
      setError(shareErrorText(e, 'Could not make the link. Try again.'))
    } finally {
      setCreating(false)
    }
  }

  const count = files.data?.length ?? fileIds.length
  return (
    <>
      <Section header={count === 1 ? 'File' : `${count} files`}>
        <div className="px-row-x py-2.5">
          <SharedFiles files={files.data ?? []} />
        </div>
      </Section>

      <Section header="Link shows">
        <ChoiceGroup
          label="Link shows"
          choices={MODE_CHOICES}
          value={mode}
          onChange={setMode}
          render={(choice) => (
            <span className="flex flex-auto flex-col gap-px">
              <span>{choice.label}</span>
              <span className="text-[11px] leading-[1.4] text-secondary">{choice.detail}</span>
            </span>
          )}
        />
      </Section>

      <Section header="Link expires">
        <ChoiceGroup
          label="Link expires"
          choices={EXPIRY_CHOICES}
          value={expiry}
          onChange={setExpiry}
          render={(choice) => <span className="flex-auto">{choice.label}</span>}
        />
      </Section>

      <p className="m-0 text-[11px] leading-[1.5] text-pretty text-secondary">
        {mode === 'latest'
          ? 'Anyone with the link can see and download these files, always at their latest version.'
          : 'Anyone with the link can see and download these files as they are now.'}
      </p>

      {error ? (
        <p data-testid="share-error" className="m-0 text-[11px] leading-[1.4] text-red">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          disabled={creating || files.data?.length === 0}
          onClick={() => void create()}
        >
          {creating ? 'Creating Link…' : 'Create Link'}
        </button>
      </div>
    </>
  )
}

export function ShareView({ fileIds, onDone }: { fileIds: string[] | null; onDone: () => void }) {
  const links = useShareLinks()
  const [created, setCreated] = useState<ShareLink | null>(null)
  const [copied, copy] = useCopied()

  const others = (links.data ?? []).filter((l) => l.publicKey !== created?.publicKey)

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 px-inset pt-12 pb-[18px]">
        <h1 data-testid="share-heading" className="m-0 text-[15px] font-semibold">
          {fileIds && !created ? 'Share Link' : 'Share Links'}
        </h1>

        {fileIds && !created ? <NewLink fileIds={fileIds} onCreated={setCreated} /> : null}

        {created ? (
          <Section header="New link">
            <div className="flex flex-col gap-2.5 px-row-x py-2.5">
              <SharedFiles files={created.files} />
              <span
                data-testid="share-url"
                className="truncate text-[12px] text-label select-text"
                title={created.url}
              >
                {created.url}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className={PRIMARY_BUTTON}
                  onClick={() => copy(created.publicKey, created.url)}
                >
                  {copied === created.publicKey ? 'Copied' : 'Copy Link'}
                </button>
                <button
                  type="button"
                  className={PLAIN_BUTTON}
                  onClick={() => void sia.openUrl(created.url)}
                >
                  Open in Browser
                </button>
              </span>
            </div>
          </Section>
        ) : null}

        <Section header="Your links">
          {others.length === 0 ? (
            <div className={`${ROW} text-secondary`} data-testid="share-links-empty">
              {links.data ? 'Links you make appear here.' : 'Loading…'}
            </div>
          ) : (
            others.map((link) => (
              <LinkRow
                key={link.publicKey}
                link={link}
                copied={copied === link.publicKey}
                onCopy={() => copy(link.publicKey, link.url)}
              />
            ))
          )}
        </Section>

        <div className="flex justify-end">
          <button type="button" className={PLAIN_BUTTON} onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * A radio group that keys the way a native one does: one stop in the tab
 * order, on the chosen option, and the arrow keys move the choice and the
 * focus together.
 */
function ChoiceGroup<C extends { id: string }>({
  label,
  choices,
  value,
  onChange,
  render,
}: {
  label: string
  choices: readonly C[]
  value: C['id']
  onChange: (id: C['id']) => void
  render: (choice: C) => ReactNode
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const move = (from: number, step: number) => {
    const next = (from + step + choices.length) % choices.length
    onChange(choices[next].id)
    buttons.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label}>
      {choices.map((choice, i) => {
        const chosen = value === choice.id
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
            className={`${ROW} w-full cursor-default border-none bg-transparent text-left text-label [font-family:inherit]`}
            onClick={() => onChange(choice.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') move(i, 1)
              else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') move(i, -1)
              else return
              e.preventDefault()
            }}
          >
            <span className={`flex w-[15px] shrink-0 ${chosen ? 'text-accent' : 'text-secondary'}`}>
              {chosen ? <CheckCircle /> : <Circle />}
            </span>
            {render(choice)}
          </button>
        )
      })}
    </div>
  )
}
