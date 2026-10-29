import { openSuite, type SuiteName, type SuiteOptions } from '../suites'
import { profileSpecs } from './structure'
import type { WorkerReply, WorkerRequest } from './protocol'

/*
 * One seeded suite in its own process, driven over IPC by the comparison
 * runner. The runner starts one worker on the PR's code and one on the base
 * commit's code, then asks each in turn to time a spec, so both sides run the
 * same spec moments apart on the same machine.
 *
 * Run with `node --expose-gc --import tsx`, with the IPC channel open. Nothing
 * is written to stdout except the suite's own seeding log, which the runner
 * prefixes and forwards.
 */

const gc = (globalThis as { gc?: () => void }).gc

function send(reply: WorkerReply) {
  process.send?.(reply)
}

async function main() {
  const [name, optionsJson] = process.argv.slice(2)
  const options = JSON.parse(optionsJson) as SuiteOptions
  const suite = await openSuite(name as SuiteName, options)
  const specs = new Map(suite.specs.map((s) => [s.name, s]))

  // One request at a time: the runner awaits each reply before sending the next.
  let queue = Promise.resolve()
  process.on('message', (message: WorkerRequest) => {
    queue = queue
      .then(() => handle(message))
      .catch((e) => {
        send({ type: 'error', message: e instanceof Error ? e.message : String(e) })
      })
  })

  async function handle(request: WorkerRequest) {
    switch (request.type) {
      case 'time': {
        const spec = specs.get(request.spec)
        if (!spec) {
          send({ type: 'error', message: `no spec named ${request.spec}` })
          return
        }
        gc?.()
        const samples: number[] = []
        for (let i = 0; i < request.iterations; i++) {
          const start = performance.now()
          await spec.run()
          samples.push(performance.now() - start)
        }
        send({ type: 'timed', samples })
        return
      }
      case 'profile': {
        send({ type: 'profiled', ...(await profileSpecs(suite.db, suite.specs)) })
        return
      }
      case 'exit':
        suite.close()
        process.exit(0)
    }
  }

  send({
    type: 'ready',
    dataset: suite.dataset,
    specs: suite.specs.map((s) => ({ name: s.name, category: s.category })),
  })
}

main().catch((e) => {
  send({ type: 'error', message: e instanceof Error ? (e.stack ?? e.message) : String(e) })
  process.exit(1)
})
