import { useSyncState } from '@siastorage/core/stores'

export function SyncStatus() {
  const { data: syncState } = useSyncState()
  const isLeader = syncState?.isLeader ?? true
  const isSyncing =
    (syncState?.isSyncingDown ?? false) || (syncState?.isSyncingUp ?? false)

  return (
    <div
      className="flex items-center px-1.5 py-1 rounded-full bg-neutral-800/80"
      title={isLeader ? undefined : 'Another tab is running sync services'}
    >
      {isSyncing ? (
        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 16 16">
          <title>Syncing</title>
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="28"
            strokeDashoffset="8"
            strokeLinecap="round"
            className="text-white"
          />
        </svg>
      ) : (
        <svg
          className="w-3.5 h-3.5 text-green-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <title>Synced</title>
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      )}
    </div>
  )
}
