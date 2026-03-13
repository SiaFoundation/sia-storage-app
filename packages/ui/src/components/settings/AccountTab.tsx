import { useState } from 'react'
import { usePlatform } from '../../context/platform'
import { useAuthStore } from '../../stores/auth'
import { ConfirmDialog } from '../ui/ConfirmDialog'

export function AccountTab() {
  const indexerUrl = useAuthStore((s) => s.indexerUrl)
  const storedKeyHex = useAuthStore((s) => s.storedKeyHex)
  const platform = usePlatform()
  const [copied, setCopied] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [confirmReset, setConfirmReset] = useState<
    'repair' | 'full' | 'signout' | null
  >(null)

  const isConnected = navigator.onLine

  function handleCopyKey() {
    if (!storedKeyHex) return
    navigator.clipboard.writeText(storedKeyHex)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h3 className="text-xs text-neutral-500 uppercase tracking-wider">
          Connection
        </h3>
        <div className="bg-neutral-900 rounded-lg border border-neutral-800 divide-y divide-neutral-800">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-neutral-400">Status</span>
            <span className="flex items-center gap-2 text-sm text-neutral-200">
              <span
                className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
              />
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-neutral-400">Indexer</span>
            <span className="text-sm text-neutral-200 font-mono">
              {indexerUrl || 'Not set'}
            </span>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-xs text-neutral-500 uppercase tracking-wider">
          Account Key
        </h3>
        <div className="bg-neutral-900 rounded-lg border border-neutral-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <code className="text-sm text-neutral-300 font-mono flex-1 break-all">
              {showKey
                ? (storedKeyHex ?? 'N/A')
                : storedKeyHex
                  ? `${storedKeyHex.slice(0, 8)}${'·'.repeat(8)}${storedKeyHex.slice(-8)}`
                  : 'N/A'}
            </code>
            {storedKeyHex && (
              <div className="flex gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200 bg-neutral-800 hover:bg-neutral-700 rounded transition-colors"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
                <button
                  type="button"
                  onClick={handleCopyKey}
                  className="px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200 bg-neutral-800 hover:bg-neutral-700 rounded transition-colors"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-xs text-red-400/70 uppercase tracking-wider">
          Danger Zone
        </h3>
        <div className="border border-red-900/50 rounded-lg divide-y divide-red-900/30">
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-neutral-200">Repair Database</p>
              <p className="text-xs text-neutral-500 mt-0.5">
                Rebuilds the database from the network. Cached files are
                preserved.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmReset('repair')}
              className="px-3 py-1.5 text-sm bg-red-900/40 hover:bg-red-900/60 text-red-300 rounded-lg transition-colors border border-red-800/50 shrink-0"
            >
              Repair
            </button>
          </div>
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-neutral-200">Full Reset</p>
              <p className="text-xs text-neutral-500 mt-0.5">
                Deletes all local data including cached files. Stays signed in.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmReset('full')}
              className="px-3 py-1.5 text-sm bg-red-900/40 hover:bg-red-900/60 text-red-300 rounded-lg transition-colors border border-red-800/50 shrink-0"
            >
              Reset
            </button>
          </div>
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-neutral-200">Sign Out and Reset</p>
              <p className="text-xs text-neutral-500 mt-0.5">
                Deletes everything including account key.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmReset('signout')}
              className="px-3 py-1.5 text-sm bg-red-900/40 hover:bg-red-900/60 text-red-300 rounded-lg transition-colors border border-red-800/50 shrink-0"
            >
              Sign Out
            </button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={confirmReset === 'repair'}
        title="Repair Database"
        message="This will rebuild the database from the network. Cached files are preserved so thumbnails won't need to re-download."
        confirmLabel="Repair"
        destructive
        onConfirm={() => {
          setConfirmReset(null)
          platform.softReset()
        }}
        onCancel={() => setConfirmReset(null)}
      />

      <ConfirmDialog
        open={confirmReset === 'full'}
        title="Full Reset"
        message="This will delete all local data including cached files and reload the app. You will stay signed in. Your files on the network are not affected."
        confirmLabel="Reset"
        destructive
        onConfirm={() => {
          setConfirmReset(null)
          platform.fullReset()
        }}
        onCancel={() => setConfirmReset(null)}
      />

      <ConfirmDialog
        open={confirmReset === 'signout'}
        title="Sign Out and Reset"
        message="This will delete all local data including your account key. You will need to sign in again. Your files on the network are not affected."
        confirmLabel="Sign Out and Reset"
        destructive
        onConfirm={() => {
          setConfirmReset(null)
          platform.signOutAndReset()
        }}
        onCancel={() => setConfirmReset(null)}
      />
    </div>
  )
}
