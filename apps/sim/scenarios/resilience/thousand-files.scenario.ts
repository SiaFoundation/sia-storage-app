import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a thousand files added on one device all reach a second and a third device',
  description:
    'The phone adds 1000 small files. The laptop and a third device converge on all of them, and the network holds each file once. The time to converge is recorded as a note.',
  devices: { phone: 'cli', laptop: 'cli', tablet: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ network, seed, converge, step, checkEqual, checkContent, note }) {
    const started = Date.now()
    await step('phone adds 1000 files', () => seed('phone', { count: 1000, size: 1024 }))
    note(`adding took ${Date.now() - started}ms`)
    const { waitedMs } = await step('all three converge', () =>
      converge(undefined, { timeoutMs: 5 * 60_000 }),
    )
    note(`converging took ${waitedMs}ms after the last add`)
    checkEqual('the network holds 1000 pinned objects', (await network.objects()).length, 1000)
    await checkContent()
  },
})
