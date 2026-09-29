/**
 * The session's mock network, run in the background so it outlives the `sim`
 * command that started it and keeps its state across device restarts.
 */
import { join } from 'node:path'
import { createNetworkControl } from '@siastorage/mock-network/control'
import { BackgroundServer } from './background'
import { REPO_ROOT, type Session } from './session'

const SERVER_ENTRY = join(REPO_ROOT, 'packages/mock-network/src/server/main.ts')

function server(session: Session): BackgroundServer {
  const dir = join(session.dir, 'network')
  return new BackgroundServer({
    dir,
    name: 'network',
    // This process's own bun, so the child is the server itself and reports
    // the pid the record holds, which a `bun` shim on PATH need not do.
    command: (port) => [process.execPath, SERVER_ENTRY, '--dir', dir, '--port', String(port)],
    probe: async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/control/health`, {
        signal: AbortSignal.timeout(2000),
      })
      return res.ok && ((await res.json()) as { pid: number }).pid
    },
  })
}

export async function startNetwork(session: Session): Promise<string> {
  const { port } = await server(session).start()
  const url = `http://127.0.0.1:${port}`
  await session.update((s) => {
    s.networkUrl = url
  })
  return url
}

export async function stopNetwork(session: Session): Promise<void> {
  await server(session).stop()
  await session.update((s) => {
    delete s.networkUrl
  })
}

export function networkControl(session: Session) {
  return createNetworkControl(session.networkUrl())
}
