import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineScenario } from '../../src/scenario'
import { sha256 } from '../../src/integrity'

export default defineScenario({
  name: 'files added on two devices reach both, and each downloads the other device’s bytes',
  description:
    'Two CLI devices each add files. Both libraries converge, the network holds each file once with its original bytes, and each device downloads a file it did not add and gets those bytes back.',
  devices: { phone: 'cli', laptop: 'cli' },
  async run({
    devices: { phone, laptop },
    network,
    seed,
    converge,
    step,
    check,
    checkEqual,
    checkContent,
    workDir,
  }) {
    const fromPhone = await step('phone adds 10 files', () =>
      seed('phone', { count: 10, size: 48 * 1024 }),
    )
    const fromLaptop = await step('laptop adds 5 files', () =>
      seed('laptop', { count: 5, size: 300 * 1024 }),
    )
    const { files } = await step('both converge', () => converge())
    checkEqual('both libraries hold all 15 files', files, 15)

    const objects = await network.objects()
    checkEqual('the network holds one pinned object per file', objects.length, 15)
    const hashes = new Set(objects.map((o) => o.contentHash))
    for (const f of [...fromPhone, ...fromLaptop]) {
      check(
        `the network holds the original bytes of ${f.name}`,
        hashes.has(sha256(readFileSync(f.path))),
      )
    }

    await step('laptop downloads a phone file and phone downloads a laptop file', async () => {
      for (const [device, file] of [
        [laptop, fromPhone[0]],
        [phone, fromLaptop[0]],
      ] as const) {
        const out = join(workDir, `${device.name}-${file.name}`)
        const result = await device.cli('download', file.id, '-o', out)
        check(
          `${device.name} download of ${file.name} succeeds`,
          result.exitCode === 0,
          result.stderr,
        )
        if (result.exitCode === 0) {
          checkEqual(
            `${device.name} gets the bytes ${file.name} was added with`,
            sha256(readFileSync(out)),
            sha256(readFileSync(file.path)),
          )
        }
      }
    })
    await checkContent()
  },
})
