import { readFileSync } from 'node:fs'
import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

const SIZE = 200_000
const LIMIT = 600_000

export default defineScenario({
  name: 'the Mac holds its cache under the limit and opens an evicted file again with the same bytes',
  description:
    'The Mac adds 10 files of 200 kB and uploads them. With the cache limit set to 600 kB and no minimum age, one eviction pass leaves at most 600 kB cached, removes the evicted files from disk, and keeps all 10 in the library. Opening each evicted file the way Finder does downloads it again with the bytes the Mac added.',
  devices: { mac: 'cli' },
  async run({ devices, seed, converge, step, precondition, check, checkEqual }) {
    const mac = devices.mac
    const files = await step('the Mac adds 10 files', () => seed('mac', { count: 10, size: SIZE }))
    await precondition('every file is uploaded', async () => {
      await converge()
      return (await mac.library()).every((f) => f.uploaded)
    })

    await step('the cache limit is 600 kB with no minimum age', async () => {
      await mac.cli('config', 'set', 'cacheMaxBytes', '600KB')
      await mac.cli('config', 'set', 'cacheMinAge', '0')
    })
    await step('one eviction pass runs', () => mac.call('cache.evict'))

    const [{ total }] = await mac.sql<{ total: number }>(
      'SELECT COALESCE(SUM(size), 0) AS total FROM fs',
    )
    check('the cache holds at most 600 kB', total <= LIMIT, `${total} bytes cached`)
    const cached = new Set(
      (await mac.sql<{ fileId: string }>('SELECT fileId FROM fs')).map((r) => r.fileId),
    )
    const evicted = files.filter((f) => !cached.has(f.id))
    check('at least seven files were evicted', evicted.length >= 7, `${evicted.length} evicted`)
    const leftOnDisk = []
    for (const f of evicted) {
      const [{ type }] = await mac.sql<{ type: string }>(
        'SELECT type FROM files WHERE id = ?',
        f.id,
      )
      if ((await mac.call('fs.sizeOnDisk', { id: f.id, type })) !== null) leftOnDisk.push(f.name)
    }
    checkEqual('no evicted file is left on disk', leftOnDisk, [])
    checkEqual('the library still lists all 10 files', (await mac.library()).length, 10)

    const wrong = []
    for (const f of evicted) {
      const target = mac.handoffTarget()
      await mac.call('provider.fetch', f.id, target)
      if (sha256(readFileSync(target)) !== sha256(readFileSync(f.path))) wrong.push(f.name)
    }
    checkEqual('every evicted file opens again with the bytes the Mac added', wrong, [])
  },
})
