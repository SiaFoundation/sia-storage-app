import {
  getPaths,
  isDaemonRunning,
  readDaemonPid,
  readState,
  sendIpcCommand,
} from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c, formatBytes, formatRelativeDate } from '../lib/format'

export async function statusCommand(dataDir: string, _opts?: { size?: boolean }) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)

  const running = isDaemonRunning(p.pidPath)
  const pid = readDaemonPid(p.pidPath)
  const state = readState(p.statePath)

  console.log(c.bold('Daemon'))
  if (running && state) {
    const uptime = formatRelativeDate(state.startedAt).replace(' ago', '')
    console.log(`  Status:    ${c.green('running')} (PID ${pid}, uptime ${uptime})`)
    console.log(`  Connected: ${state.connected ? c.green('yes') : c.red('no')}`)
  } else if (running) {
    console.log(`  Status: ${c.green('running')} (PID ${pid})`)
  } else {
    console.log(`  Status: ${c.dim('stopped')}`)
  }

  try {
    const app = createDaemonClient(p.sockPath)

    const indexerURL = await app.settings.getIndexerURL()

    if (indexerURL) {
      console.log()
      console.log(c.bold('Indexer'))
      console.log(`  ${c.dim(indexerURL)}`)
    }

    const fileCount = await app.library.fileCount()
    const allFiles = await app.files.query({ limit: 10000, order: 'ASC' })
    const totalSize = allFiles.reduce((sum: number, f: any) => sum + f.size, 0)

    console.log()
    console.log(c.bold('Library'))
    console.log(`  Files: ${fileCount} (${formatBytes(totalSize)})`)

    if (indexerURL) {
      const stats = await app.stats.uploadStats(indexerURL)
      const o = stats.overall

      let uploadState: any = null
      const batchFileIds = new Set<string>()
      try {
        uploadState = await sendIpcCommand(p.sockPath, 'uploadState', {}, 2000)
      } catch {
        // Daemon not responding to IPC
      }

      if (o.total > 0) {
        let activeBytes = 0
        if (uploadState?.active) {
          for (const entry of uploadState.active) {
            activeBytes += (entry.progress ?? 0) * (entry.size ?? 0)
          }
        }
        const effectiveBytes = o.uploadedBytes + activeBytes
        const pctDecimal = o.totalBytes > 0 ? effectiveBytes / o.totalBytes : 1
        const pctStr = `${(pctDecimal * 100).toFixed(1)}%`.padStart(6)
        const pct = pctDecimal === 1 ? c.green('100%') : c.yellow(pctStr)

        console.log()
        console.log(c.bold('Uploads'))
        console.log(
          `  Progress: ${pct} (${o.uploaded}/${o.total} files, ${formatBytes(effectiveBytes)} / ${formatBytes(o.totalBytes)})`,
        )
        if (o.remaining > 0) {
          console.log(`  Pending:  ${o.remaining} files`)
        }
      }

      if (uploadState?.batch?.files?.length > 0) {
        const batchFiles = uploadState.batch.files as Array<{
          fileId: string
          name: string
          size: number
        }>
        const batchTotalSize = batchFiles.reduce((s: number, f) => s + f.size, 0)
        const activeMap = new Map<string, number>()
        for (const entry of uploadState.active ?? []) {
          activeMap.set(entry.id, entry.progress ?? 0)
        }
        const batchUploadedBytes = batchFiles.reduce(
          (s: number, f) => s + (activeMap.get(f.fileId) ?? 0) * f.size,
          0,
        )
        const batchPct = batchTotalSize > 0 ? batchUploadedBytes / batchTotalSize : 0
        const batchPctStr = `${(batchPct * 100).toFixed(0)}%`

        console.log()
        console.log(
          `${c.bold('Batch')}  ${c.yellow(batchPctStr)}  ${c.dim(`(${formatBytes(batchUploadedBytes)} / ${formatBytes(batchTotalSize)})`)}`,
        )
        for (const file of batchFiles) {
          batchFileIds.add(file.fileId)
          console.log(`  ${c.yellow('●')} ${file.name}  ${c.dim(`(${formatBytes(file.size)})`)}`)
        }
      }

      if (uploadState?.errored > 0) {
        console.log(`  ${c.red(`${uploadState.errored} errored`)}`)
      }

      if (o.remaining > 0) {
        const pendingFiles = await app.files.query({
          limit: 10 + batchFileIds.size,
          order: 'ASC',
          pinned: { indexerURL, isPinned: false },
        })
        const filtered = pendingFiles.filter((f: any) => !batchFileIds.has(f.id)).slice(0, 10)
        if (filtered.length > 0) {
          const pendingCount = o.remaining - batchFileIds.size
          console.log()
          console.log(c.bold('Pending'))
          for (const file of filtered) {
            console.log(`  ${c.dim('○')} ${file.name}  ${c.dim(`(${formatBytes(file.size)})`)}`)
          }
          if (pendingCount > filtered.length) {
            console.log(`  ${c.dim(`... and ${pendingCount - filtered.length} more`)}`)
          }
        }
      }
    }
  } catch {
    // Daemon not responding
  }
}
