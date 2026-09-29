import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'three devices adding the same file name, two of them offline, end with one identical current version',
  description:
    'Two of three devices go offline, and each device adds its own report.txt to docs. After they reconnect, every device shows the same three versions with the same one marked current.',
  devices: { a: 'cli', b: 'cli', c: 'cli' },
  async run({ devices, network, converge, step, checkEqual, checkContent, workDir }) {
    await network.setOffline('b', true)
    await network.setOffline('c', true)
    await step('each device adds its own report.txt in docs', async () => {
      for (const name of ['a', 'b', 'c'] as const) {
        const path = `${workDir}/${name}/report.txt`
        await Bun.write(path, `report written on ${name} ${crypto.randomUUID()}`)
        await devices[name].addFile(path, { dir: 'docs' })
      }
    })
    await network.setOffline('b', false)
    await network.setOffline('c', false)
    await step('all three converge', () => converge(undefined, { timeoutMs: 90_000 }))
    for (const name of ['a', 'b', 'c'] as const) {
      const versions = (await devices[name].library()).filter((f) => f.name === 'report.txt')
      checkEqual(`${name} has three versions`, versions.length, 3)
      checkEqual(`${name} has one current version`, versions.filter((f) => f.current).length, 1)
    }
    await checkContent()
  },
})
