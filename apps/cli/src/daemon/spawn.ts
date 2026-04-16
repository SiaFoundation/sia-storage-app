import * as fs from 'fs'
import { spawn } from 'child_process'
import type { getPaths } from '@siastorage/node-adapters'

export function spawnDaemon(paths: ReturnType<typeof getPaths>): void {
  const logFd = fs.openSync(paths.logPath, 'a')

  // For a `bun build --compile` binary, process.argv[1] equals process.execPath
  // (both point at the binary). When running `bun run src/index.ts`, argv[1] is
  // the script path while execPath is the bun runtime — pass the script through.
  const args = process.argv[1] === process.execPath ? [] : [process.argv[1]]

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      SIA_DATA_DIR: paths.dataDir,
      SIA_DAEMON_MODE: '1',
    },
  })

  child.unref()
  fs.closeSync(logFd)
}
