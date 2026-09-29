/**
 * Runs the mock network as a process: `bun main.ts --dir <state dir> [--port n]`.
 * Prints `ready <url>` once it is listening.
 */
import { parseArgs } from 'node:util'
import { startMockNetwork } from './index'

const { values } = parseArgs({
  options: { dir: { type: 'string' }, port: { type: 'string' } },
})
if (!values.dir) {
  console.error('usage: main.ts --dir <state dir> [--port <port>]')
  process.exit(2)
}

const network = startMockNetwork({ dir: values.dir, port: Number(values.port ?? 0) })
console.log(`ready ${network.url}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void network.stop().then(() => process.exit(0))
  })
}
