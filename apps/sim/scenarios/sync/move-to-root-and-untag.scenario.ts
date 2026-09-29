import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'moving a file out of a folder to the root, and removing its last tag, reach the other device',
  description:
    'The phone adds two files in docs and tags one. After both converge, the phone moves the first to the root and removes the only tag from the second. The laptop ends with the first file at the root and the second with no tags.',
  devices: { phone: 'cli', laptop: 'cli' },
  knownBug:
    'Sync-up leaves the folder out of a root file’s metadata and the tags out of an untagged file’s, and sync-down reads a missing field as no change, so other devices keep the old folder and tag.',
  bugShowsAs: [
    'every device holds the same library at the end',
    { check: 'laptop shows the first file at the root', got: false },
    { check: 'laptop shows no tags on the second file', got: [{ name: 'keep' }] },
  ],
  async run({
    devices: { phone, laptop },
    seed,
    converge,
    step,
    precondition,
    checkEqual,
    waitFor,
  }) {
    const [a, b] = await step('phone adds 2 files in docs', () =>
      seed('phone', { count: 2, size: 2048, dir: 'docs' }),
    )
    await step('phone tags the second file', () => phone.call('tags.add', b.id, 'keep'))
    await step('both converge', () => converge())
    const tagsOn = (fileId: string) =>
      laptop.sql<{ name: string }>(
        'SELECT t.name FROM file_tags ft JOIN tags t ON t.id = ft.tagId WHERE ft.fileId = ?1',
        fileId,
      )
    await precondition('the laptop sees the tag', async () =>
      (await tagsOn(b.id)).some((t) => t.name === 'keep'),
    )

    await step('phone moves the first file to the root', () =>
      phone.call('files.moveFile', a.id, null),
    )
    await step('phone removes the tag', async () => {
      const [tag] = await phone.call<Array<{ id: string }>>('tags.getForFile', b.id)
      await phone.call('tags.remove', b.id, tag.id)
    })
    // A converge would time out on the bug itself, since the two libraries
    // never agree, so the laptop's state is waited for and checked instead.
    const atRoot = async () => (await laptop.library()).find((f) => f.id === a.id)?.dir === null
    await waitFor(
      'the laptop to show the move and the removed tag',
      async () => ((await atRoot()) && (await tagsOn(b.id)).length === 0) || undefined,
      { timeoutMs: 30_000, intervalMs: 500 },
    ).catch(() => {})
    checkEqual('laptop shows the first file at the root', await atRoot(), true)
    checkEqual('laptop shows no tags on the second file', await tagsOn(b.id), [])
  },
})
