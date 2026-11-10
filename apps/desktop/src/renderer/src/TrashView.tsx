/*
 * The trash, in the window, opened from the status view.
 *
 * Each row is a file with the versions trashed along with it, as Finder's
 * delete leaves them, or a deleted folder with every file it held, with
 * Restore and Delete. Empty Trash deletes everything
 * in it. Delete and Empty Trash take a second click, as Revoke on a share link
 * does, since neither can be undone.
 */

import { useApp } from '@siastorage/core/app'
import { itemCount, restoredText, trashEntryDetail } from '@siastorage/core/lib/trashText'
import { TRASH_PAGE, useTrashCount, useTrashEntries } from '@siastorage/core/stores'
import type { RestoredFile, TrashEntry } from '@siastorage/core/types'
import { useState } from 'react'
import { PLAIN_BUTTON, SMALL_BUTTON } from './buttons'
import { ROW, Section } from './Group'
import { Folder, Trash } from './icons'
import { useConfirm } from './useConfirm'
import { useNow } from './useNow'

function EntryRow({
  entry,
  now,
  onRestored,
}: {
  entry: TrashEntry
  now: number
  onRestored: (restored: RestoredFile[]) => void
}) {
  const app = useApp()
  const [confirming, setConfirming] = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = (action: () => Promise<unknown>, failure: string) => {
    setBusy(true)
    setError(null)
    action()
      .catch(() => setError(failure))
      .finally(() => setBusy(false))
  }

  return (
    <div className={ROW} data-entry-id={entry.id}>
      <span className="flex w-[15px] shrink-0 text-secondary">
        {entry.kind === 'folder' ? <Folder /> : <Trash />}
      </span>
      <span className="flex min-w-0 flex-auto flex-col gap-px">
        <span data-testid="trash-entry" className="truncate">
          {entry.name}
        </span>
        <span className="text-[11px] leading-[1.4] text-secondary">
          {trashEntryDetail(entry, now)}
        </span>
        {error ? <span className="text-[11px] leading-[1.4] text-red">{error}</span> : null}
      </span>
      <span className="flex shrink-0 gap-0.5 pr-1">
        <button
          type="button"
          className={`${SMALL_BUTTON} text-accent`}
          aria-label={`Restore ${entry.name}`}
          disabled={busy}
          onClick={() =>
            run(
              () => app.files.restoreTrashEntries([entry.id]).then(onRestored),
              'Could not restore it. Try again.',
            )
          }
        >
          Restore
        </button>
        <button
          type="button"
          className={`${SMALL_BUTTON} ${confirming ? 'text-red' : 'text-secondary'}`}
          aria-label={confirming ? `Delete ${entry.name} for good` : `Delete ${entry.name}`}
          disabled={busy}
          onClick={() => {
            if (!confirming) return setConfirming(true)
            run(() => app.files.deleteTrashEntries([entry.id]), 'Could not delete it. Try again.')
          }}
        >
          {confirming ? 'Delete for good' : 'Delete'}
        </button>
      </span>
    </div>
  )
}

export function TrashView({ onDone }: { onDone: () => void }) {
  const app = useApp()
  const [limit, setLimit] = useState(TRASH_PAGE)
  const entries = useTrashEntries(limit)
  // The whole trash, which Empty Trash deletes, where the list may show part.
  const count = useTrashCount().data ?? 0
  const hidden = count - (entries.data?.length ?? 0)
  const now = useNow()
  const [confirming, setConfirming] = useConfirm()
  const [emptying, setEmptying] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 px-inset pt-[calc(18px+var(--title-bar-clearance))] pb-[18px]">
        <h1 data-testid="trash-heading" className="m-0 text-[15px] font-semibold">
          Trash
        </h1>

        {notice ? (
          <p
            data-testid="trash-notice"
            className={`m-0 text-[11px] leading-[1.5] ${notice.error ? 'text-red' : 'text-secondary'}`}
          >
            {notice.text}
          </p>
        ) : null}
        <Section header={itemCount(count)}>
          {!entries.data?.length ? (
            <div className={`${ROW} text-secondary`} data-testid="trash-empty">
              {entries.data ? 'The trash is empty.' : 'Loading…'}
            </div>
          ) : (
            entries.data.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                now={now}
                onRestored={(restored) =>
                  // A plain restore needs no words: the row leaving the list says it.
                  setNotice(
                    restored.length > 0 &&
                      restored.every((r) => !r.renamedFrom) &&
                      (entry.kind === 'folder' || restored.length === 1)
                      ? null
                      : { text: restoredText(entry.name, restored, entry.kind), error: false },
                  )
                }
              />
            ))
          )}
          {hidden > 0 ? (
            <button
              type="button"
              className={`${ROW} text-accent`}
              onClick={() => setLimit((n) => n + TRASH_PAGE)}
            >
              Show {Math.min(hidden, TRASH_PAGE).toLocaleString()} more
            </button>
          ) : null}
        </Section>
        <p className="m-0 text-[11px] leading-[1.5] text-secondary">
          Files in the trash are deleted for good 30 days after you trash them.
        </p>

        <div className="flex justify-end gap-2">
          {count > 0 ? (
            <button
              type="button"
              className={`${PLAIN_BUTTON} ${confirming ? 'text-red' : ''}`}
              disabled={emptying}
              onClick={() => {
                if (!confirming) return setConfirming(true)
                setEmptying(true)
                setNotice(null)
                app.files
                  .emptyTrash()
                  .catch(() =>
                    setNotice({ text: 'Could not empty the trash. Try again.', error: true }),
                  )
                  .finally(() => setEmptying(false))
              }}
            >
              {confirming ? `Delete ${itemCount(count)} for good` : 'Empty Trash'}
            </button>
          ) : null}
          <button type="button" className={PLAIN_BUTTON} onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
