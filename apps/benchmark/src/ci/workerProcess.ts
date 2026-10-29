import { type ChildProcess, spawn } from 'child_process'
import * as readline from 'readline'
import type { SuiteName, SuiteOptions } from '../suites'
import type { WorkerReply, WorkerRequest } from './protocol'

type Ready = Extract<WorkerReply, { type: 'ready' }>

/** The runner's handle on one worker process. Requests go one at a time, and
 * the worker's own log lines are forwarded to stderr under `label`. */
export class WorkerProcess {
  private child: ChildProcess
  private pending: ((reply: WorkerReply) => void) | null = null
  private exited: string | null = null
  readonly ready: Promise<Ready>

  constructor(
    readonly label: string,
    benchDir: string,
    workerFile: string,
    suite: SuiteName,
    options: SuiteOptions,
  ) {
    this.child = spawn(
      process.execPath,
      ['--expose-gc', '--import', 'tsx', workerFile, suite, JSON.stringify(options)],
      { cwd: benchDir, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    )
    for (const stream of [this.child.stdout, this.child.stderr]) {
      if (!stream) continue
      readline.createInterface({ input: stream }).on('line', (line) => {
        process.stderr.write(`[${label}] ${line}\n`)
      })
    }

    let resolveReady!: (r: Ready) => void
    let rejectReady!: (e: Error) => void
    this.ready = new Promise((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    // Settled here so a worker that dies before anyone awaits `ready` is not
    // an unhandled rejection.
    this.ready.catch(() => {})

    let started = false
    this.child.on('message', (reply: WorkerReply) => {
      if (!started) {
        started = true
        if (reply.type === 'ready') resolveReady(reply)
        else rejectReady(new Error(reply.type === 'error' ? reply.message : 'unexpected reply'))
        return
      }
      const settle = this.pending
      this.pending = null
      settle?.(reply)
    })
    this.child.on('exit', (code, signal) => {
      this.exited = `exited with ${signal ?? code}`
      if (!started) rejectReady(new Error(`${label} ${this.exited} before it was ready`))
      const settle = this.pending
      this.pending = null
      settle?.({ type: 'error', message: `${label} ${this.exited}` })
    })
  }

  request(request: WorkerRequest): Promise<WorkerReply> {
    if (this.exited)
      return Promise.resolve({ type: 'error', message: `${this.label} ${this.exited}` })
    if (this.pending) throw new Error(`${this.label} already has a request in flight`)
    return new Promise((resolve) => {
      this.pending = resolve
      this.child.send(request)
    })
  }

  async time(spec: string, iterations: number): Promise<number[]> {
    const reply = await this.request({ type: 'time', spec, iterations })
    if (reply.type === 'timed') return reply.samples
    throw new Error(reply.type === 'error' ? reply.message : `unexpected ${reply.type} reply`)
  }

  stop() {
    if (this.exited) return
    this.child.send({ type: 'exit' } satisfies WorkerRequest)
  }
}
