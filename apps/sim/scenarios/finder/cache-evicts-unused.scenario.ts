import { readFileSync } from 'node:fs'
import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

const SIZE = 200_000

export default defineScenario({
  name: 'the Mac frees every uploaded file nobody is using and opens an evicted file again with the same bytes',
  description:
    'The Mac adds 10 files of 200 kB and uploads them. With no hold time, one eviction pass removes every cached copy from the database and from disk, though 2 MB is far less than the Mac could hold, and keeps all 10 in the library. Opening each evicted file the way Finder does downloads it again with the bytes the Mac added.',
  devices: { mac: 'cli' },
  async run({ devices, seed, converge, step, precondition, check, checkEqual }) {
    const mac = devices.mac
    const files = await step('the Mac adds 10 files', () => seed('mac', { count: 10, size: SIZE }))
    await precondition('every file is uploaded', async () => {
      await converge()
      return (await mac.library()).every((f) => f.uploaded)
    })

    await step('the hold time is 0', () => mac.cli('config', 'set', 'cacheMinAge', '0'))
    await step('one eviction pass runs', () => mac.call('cache.evict'))

    const [{ total }] = await mac.sql<{ total: number }>(
      'SELECT COALESCE(SUM(size), 0) AS total FROM fs',
    )
    const cached = new Set(
      (await mac.sql<{ fileId: string }>('SELECT fileId FROM fs')).map((r) => r.fileId),
    )
    const evicted = files.filter((f) => !cached.has(f.id))
    checkEqual('every one of the 10 files was evicted', evicted.length, 10)
    check('no cached copy of the 10 is left', total < SIZE, `${total} bytes cached`)
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
