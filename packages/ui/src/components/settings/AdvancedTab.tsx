import { useState } from 'react'
import { ConfirmDialog } from '../ui/ConfirmDialog'

export function AdvancedTab() {
  const [confirmAction, setConfirmAction] = useState<
    'syncDown' | 'syncUp' | null
  >(null)

  function handleResetSyncDown() {
    localStorage.removeItem('syncDownCursor')
    setConfirmAction(null)
  }

  function handleResetSyncUp() {
    localStorage.removeItem('syncUpCursor')
    setConfirmAction(null)
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h3 className="text-xs text-neutral-500 uppercase tracking-wider">
          Sync Cursors
        </h3>
        <div className="bg-neutral-900 rounded-lg border border-neutral-800 divide-y divide-neutral-800">
          <div className="px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-neutral-200">Reset sync down cursor</p>
              <p className="text-xs text-neutral-500 mt-0.5">
                Resync all events from the beginning.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmAction('syncDown')}
              className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors border border-neutral-700 shrink-0"
            >
              Reset
            </button>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-neutral-200">Reset sync up cursor</p>
              <p className="text-xs text-neutral-500 mt-0.5">
                Re-push metadata for all files.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmAction('syncUp')}
              className="px-3 py-1.5 text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors border border-neutral-700 shrink-0"
            >
              Reset
            </button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={confirmAction === 'syncDown'}
        title="Reset Sync Down Cursor"
        message="This will reset the sync down cursor and cause the app to resync all events from the beginning. Continue?"
        confirmLabel="Reset"
        destructive
        onConfirm={handleResetSyncDown}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmDialog
        open={confirmAction === 'syncUp'}
        title="Reset Sync Up Cursor"
        message="This will reset the sync up cursor and cause the app to re-push metadata for all files. Continue?"
        confirmLabel="Reset"
        destructive
        onConfirm={handleResetSyncUp}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}
