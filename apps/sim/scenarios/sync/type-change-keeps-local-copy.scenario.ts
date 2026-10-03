import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "a type change made on one device keeps another device's local copy of the file",
  description:
    'The laptop adds a file of unknown type and the desk downloads it. The laptop then changes the file to text. Once the change reaches the desk, the desk still has the file on disk, under the name its new type gives it.',
  devices: { laptop: 'cli', desk: 'cli' },
  knownBug:
    'Sync-down records the new type but leaves the local bytes under the old extension, and a device finds a file on disk by the extension its type names, so the desk drops its local copy the next time it looks.',
  bugShowsAs: ['still finds the file on disk', 'keeps its record of the local copy'],
  async run({
    devices: { laptop, desk },
    seed,
    converge,
    step,
    precondition,
    check,
    checkEqual,
    waitFor,
    workDir,
  }) {
    const [file] = await step('laptop adds a file', () => seed('laptop', { count: 1, size: 4096 }))
    await step('both converge', () => converge())
    await step('desk downloads it', async () => {
      // Written into the scenario's own folder, since `sia download` defaults
      // to the working directory.
      const result = await desk.cli('download', file.name, '--output', `${workDir}/${file.name}`)
      if (result.exitCode !== 0) throw new Error(`sia download failed: ${result.stderr}`)
    })
    await precondition(
      'desk has it on disk',
      async () => (await desk.call('fs.readMeta', file.id)) !== null,
    )
    await step('laptop changes it to text', () =>
      laptop.call('files.update', { id: file.id, type: 'text/plain' }, { updatedAt: 'now' }),
    )
    await step('the change reaches the desk', () =>
      waitFor('the desk to store text/plain', async () => {
        const [row] = await desk.sql<{ type: string }>(
          'SELECT type FROM files WHERE id = ?1',
          file.id,
        )
        return row?.type === 'text/plain' ? true : undefined
      }),
    )
    const uri = await desk.call<string | null>('fs.getFileUri', { id: file.id, type: 'text/plain' })
    check('desk still finds the file on disk', uri !== null, String(uri))
    checkEqual(
      'desk keeps its record of the local copy',
      (await desk.call('fs.readMeta', file.id)) !== null,
      true,
    )
  },
})
