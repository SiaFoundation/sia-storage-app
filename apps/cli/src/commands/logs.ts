import { spawn } from 'child_process'
import * as fs from 'fs'
import { getPaths } from '@siastorage/node-adapters'
import { c } from '../lib/format'

export async function logsCommand(dataDir: string, opts?: { follow?: boolean; lines?: string }) {
  const p = getPaths(dataDir)

  if (!fs.existsSync(p.logPath)) {
    console.log(c.dim('No daemon logs yet'))
    return
  }

  const lineCount = parseInt(opts?.lines ?? '50', 10)

  if (opts?.follow) {
    // Tail and follow
    const tail = spawn('tail', ['-f', '-n', String(lineCount), p.logPath], {
      stdio: 'inherit',
    })
    process.on('SIGINT', () => {
      tail.kill()
      process.exit(0)
    })
    await new Promise<void>((resolve) => {
      tail.on('exit', () => resolve())
    })
  } else {
    // Read last N lines
    const content = fs.readFileSync(p.logPath, 'utf-8')
    const lines = content.split('\n').filter(Boolean)
    const lastLines = lines.slice(-lineCount)
    for (const line of lastLines) {
      console.log(line)
    }
  }
}
