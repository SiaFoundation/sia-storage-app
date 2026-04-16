import {
  getPaths,
  isDaemonRunning,
  readDaemonPid,
  readState,
  sendIpcCommand,
} from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { c, formatRelativeDate } from '../lib/format'

export async function daemonCommand(
  dataDir: string,
  action: string,
  _opts?: { foreground?: boolean },
) {
  const p = getPaths(dataDir)

  switch (action) {
    case 'start': {
      if (isDaemonRunning(p.pidPath)) {
        const pid = readDaemonPid(p.pidPath)
        console.log(`Daemon already running (PID: ${pid})`)
        return
      }
      await ensureDaemonRunning(p)
      const pid = readDaemonPid(p.pidPath)
      console.log(c.green(`Daemon started (PID: ${pid})`))
      break
    }

    case 'stop': {
      const pid = readDaemonPid(p.pidPath)
      if (!pid || !isDaemonRunning(p.pidPath)) {
        console.log(c.dim('Daemon is not running'))
        return
      }
      try {
        await sendIpcCommand(p.sockPath, 'shutdown', {}, 5000)
      } catch {
        // IPC may close before we get a response, that's fine
      }
      // Wait for process to exit
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        try {
          process.kill(pid, 0)
          await new Promise((r) => setTimeout(r, 100))
        } catch {
          break
        }
      }
      console.log(c.green('Daemon stopped'))
      break
    }

    case 'restart': {
      const pid = readDaemonPid(p.pidPath)
      if (pid && isDaemonRunning(p.pidPath)) {
        try {
          await sendIpcCommand(p.sockPath, 'shutdown', {}, 5000)
        } catch {
          // fine
        }
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
          try {
            process.kill(pid, 0)
            await new Promise((r) => setTimeout(r, 100))
          } catch {
            break
          }
        }
      }
      await ensureDaemonRunning(p)
      const newPid = readDaemonPid(p.pidPath)
      console.log(c.green(`Daemon restarted (PID: ${newPid})`))
      break
    }

    case 'status':
    default: {
      const running = isDaemonRunning(p.pidPath)
      const pid = readDaemonPid(p.pidPath)
      const state = readState(p.statePath)

      if (!running) {
        console.log(`Daemon: ${c.dim('stopped')}`)
        return
      }

      console.log(`Daemon:    ${c.green('running')}`)
      console.log(`PID:       ${pid}`)
      if (state) {
        console.log(`Uptime:    ${formatRelativeDate(state.startedAt).replace(' ago', '')}`)
        console.log(`Connected: ${state.connected ? c.green('yes') : c.red('no')}`)
      }
      break
    }
  }
}
