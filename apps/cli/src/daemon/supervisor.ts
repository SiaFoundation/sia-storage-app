import { isDaemonRunning, sendIpcCommand, type getPaths } from '@siastorage/node-adapters'
import { spawnDaemon } from './spawn'

export async function ensureDaemonRunning(paths: ReturnType<typeof getPaths>): Promise<void> {
  if (isDaemonRunning(paths.pidPath)) return

  spawnDaemon(paths)

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
    try {
      await sendIpcCommand(paths.sockPath, 'ping', {}, 2000)
      return
    } catch {
      // not ready yet
    }
  }

  console.error('Failed to start daemon within 15 seconds. Check "sia logs" for details.')
  process.exit(1)
}

export async function daemonCommand(
  paths: ReturnType<typeof getPaths>,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  await ensureDaemonRunning(paths)
  return sendIpcCommand(paths.sockPath, method, params)
}
