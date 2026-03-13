import { useApp, useSyncState } from '@siastorage/core/stores'
import { useEffect, useState } from 'react'
import { useAuthStore } from '../../stores/auth'
import { Dialog, DialogHeader } from '../ui/Dialog'
import { formatBytes } from './format'

type StatusModalProps = {
  open: boolean
  onClose: () => void
}

type CategoryStat = {
  total: number
  totalBytes: number
  uploaded: number
  uploadedBytes: number
}

type FileStats = {
  all: CategoryStat
  images: CategoryStat
  videos: CategoryStat
  audio: CategoryStat
  documents: CategoryStat
  other: CategoryStat
  thumbnails: { count: number; bytes: number }
}

function emptyStat(): CategoryStat {
  return { total: 0, totalBytes: 0, uploaded: 0, uploadedBytes: 0 }
}

export function StatusModal({ open, onClose }: StatusModalProps) {
  const app = useApp()
  const { data: syncState } = useSyncState()
  const isSyncingDown = syncState?.isSyncingDown ?? false
  const isSyncingUp = syncState?.isSyncingUp ?? false
  const syncDownAdded = syncState?.syncDownAdded ?? 0
  const syncDownDeleted = syncState?.syncDownDeleted ?? 0
  const syncUpProcessed = syncState?.syncUpProcessed ?? 0
  const syncUpTotal = syncState?.syncUpTotal ?? 0
  const indexerUrl = useAuthStore((s) => s.indexerUrl)
  const [stats, setStats] = useState<FileStats | null>(null)
  const [showSize, setShowSize] = useState(false)
  const [isConnected, setIsConnected] = useState(true)

  useEffect(() => {
    if (!open) return

    setIsConnected(navigator.onLine)

    async function loadStats() {
      const rows = await app.files.getActiveSummaries()

      const uploadedIds = await app.files.getUploadedIds(indexerUrl)
      const uploadedSet = new Set(uploadedIds)

      const s: FileStats = {
        all: emptyStat(),
        images: emptyStat(),
        videos: emptyStat(),
        audio: emptyStat(),
        documents: emptyStat(),
        other: emptyStat(),
        thumbnails: { count: 0, bytes: 0 },
      }

      for (const row of rows) {
        if (row.kind === 'thumbnail') {
          s.thumbnails.count++
          s.thumbnails.bytes += row.size
          continue
        }
        if (row.kind !== 'file') continue

        const isUploaded = uploadedSet.has(row.id)

        s.all.total++
        s.all.totalBytes += row.size
        if (isUploaded) {
          s.all.uploaded++
          s.all.uploadedBytes += row.size
        }

        let cat: CategoryStat
        if (row.type.startsWith('image/')) {
          cat = s.images
        } else if (row.type.startsWith('video/')) {
          cat = s.videos
        } else if (row.type.startsWith('audio/')) {
          cat = s.audio
        } else if (
          row.type.startsWith('text/') ||
          row.type === 'application/pdf'
        ) {
          cat = s.documents
        } else {
          cat = s.other
        }

        cat.total++
        cat.totalBytes += row.size
        if (isUploaded) {
          cat.uploaded++
          cat.uploadedBytes += row.size
        }
      }

      setStats(s)
    }

    loadStats()
  }, [open, app, indexerUrl])

  function formatStat(s: CategoryStat): string {
    if (showSize) {
      return `${formatBytes(s.uploadedBytes)} / ${formatBytes(s.totalBytes)}`
    }
    return `${s.uploaded.toLocaleString()} / ${s.total.toLocaleString()}`
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="max-w-lg"
      className="max-h-[80vh] flex flex-col sm:min-w-[360px]"
    >
      <div className="sticky top-0 bg-neutral-900 z-10">
        <DialogHeader title="Status" onClose={onClose} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <section>
          <h3 className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-2.5">
            Connectivity
          </h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
              />
              <span className="text-[13px] text-neutral-300">Internet</span>
              <span className="ml-auto text-xs text-neutral-500">
                {isConnected ? 'Connected' : 'Offline'}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
              />
              <span className="text-[13px] text-neutral-300">Indexer</span>
              <span className="ml-auto text-xs text-neutral-500">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider mb-2.5">
            Sync Metadata
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${isSyncingDown ? 'bg-yellow-400' : 'bg-green-500'}`}
                />
                <span className="text-[13px] text-neutral-400">
                  Remote down
                </span>
              </div>
              <span className="text-neutral-300 font-mono text-xs">
                {isSyncingDown ? (
                  <>
                    Syncing
                    {syncDownAdded > 0 && ` +${syncDownAdded.toLocaleString()}`}
                    {syncDownDeleted > 0 &&
                      ` -${syncDownDeleted.toLocaleString()}`}
                  </>
                ) : (
                  'Synced'
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${isSyncingUp ? 'bg-yellow-400' : 'bg-green-500'}`}
                />
                <span className="text-[13px] text-neutral-400">Local up</span>
              </div>
              <span className="text-neutral-300 font-mono text-xs">
                {isSyncingUp
                  ? `${syncUpProcessed.toLocaleString()}/${syncUpTotal.toLocaleString()}`
                  : 'Synced'}
              </span>
            </div>
          </div>
        </section>

        {stats && (
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
                Network Files
              </h3>
              <button
                type="button"
                onClick={() => setShowSize(!showSize)}
                className="text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors px-1.5 py-0.5 rounded-md bg-neutral-800"
              >
                {showSize ? 'Count' : 'Size'}
              </button>
            </div>
            <div className="space-y-1.5">
              <StatRow label="All" value={formatStat(stats.all)} />
              <StatRow label="Photos" value={formatStat(stats.images)} />
              <StatRow label="Videos" value={formatStat(stats.videos)} />
              <StatRow label="Audio" value={formatStat(stats.audio)} />
              <StatRow label="Documents" value={formatStat(stats.documents)} />
              <StatRow label="Other" value={formatStat(stats.other)} />
              <div className="border-t border-neutral-800/80 pt-1.5 mt-1.5">
                <StatRow
                  label="Thumbnails"
                  value={
                    showSize
                      ? formatBytes(stats.thumbnails.bytes)
                      : stats.thumbnails.count.toLocaleString()
                  }
                />
              </div>
            </div>
          </section>
        )}
      </div>
    </Dialog>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-neutral-400">{label}</span>
      <span className="text-neutral-300 font-mono text-xs">{value}</span>
    </div>
  )
}
