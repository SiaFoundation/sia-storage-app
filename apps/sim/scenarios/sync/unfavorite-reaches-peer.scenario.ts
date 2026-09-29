import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'taking a file out of Favorites on one device takes it out on the other',
  description:
    'The phone adds a file, favorites it and tags it keep, and the laptop sees both. The phone then unfavorites it. The laptop ends with the file out of Favorites and still tagged keep.',
  devices: { phone: 'cli', laptop: 'cli' },
  async run({ devices: { phone, laptop }, seed, converge, step, checkEqual, waitFor }) {
    const [file] = await step('phone adds a file', () => seed('phone', { count: 1, size: 2048 }))
    await step('phone favorites it and tags it keep', async () => {
      await phone.call('tags.toggleFavorite', file.id)
      await phone.call('tags.add', file.id, 'keep')
    })
    // The library sim compares lists Favorites among a file's tags, so once
    // both converge the laptop has it favorited.
    await step('both converge', () => converge())
    const favoriteOnLaptop = () => laptop.call<boolean>('tags.isFavorite', file.id)

    await step('phone unfavorites it', () => phone.call('tags.toggleFavorite', file.id))
    // A converge would time out on the bug itself, since the two libraries
    // never agree, so the laptop's answer is waited for and checked instead.
    const out = await waitFor(
      'the laptop to take it out of Favorites',
      async () => ((await favoriteOnLaptop()) ? undefined : true),
      { timeoutMs: 30_000, intervalMs: 500 },
    ).catch(() => false)
    checkEqual('laptop shows the file out of Favorites', out, true)
    const tags = await laptop.call<Array<{ name: string }>>('tags.getForFile', file.id)
    checkEqual(
      'laptop keeps its other tag',
      tags.map((t) => t.name),
      ['keep'],
    )
  },
})
