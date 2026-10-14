import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a link made with sia share is listed and changed on the other device straight away',
  description:
    'The laptop shares two files with `sia share`, and the desk lists the link at once, without waiting for its background refresh. The desk adds a third file to the link and the laptop takes one off, each naming the link the other made or changed, then the laptop revokes it and the desk lists no link.',
  devices: { laptop: 'cli', desk: 'cli' },
  async run({ devices: { laptop, desk }, seed, converge, step, check, checkEqual }) {
    const [a, b, c] = await step('laptop adds three files', () =>
      seed('laptop', { count: 3, size: 16 * 1024, prefix: 'link' }),
    )
    await step('both converge', () => converge())

    const made = await step('laptop shares two of them', () => laptop.cli('share', a.name, b.name))
    const url = made.stdout.trim()
    check('sia share prints the link', url.startsWith('https://'), made.stdout)

    /**
     * The file names under `url` in the device's `sia links --json`, or null
     * without the link. Read once, not waited for: the daemons refresh links
     * in the background only every few minutes, so a command that answers
     * from its local copy fails these checks.
     */
    const filesOn = async (device: typeof desk) => {
      const { stdout } = await device.cli('links', '--json')
      const links = JSON.parse(stdout) as Array<{ url: string; files: Array<{ name: string }> }>
      const link = links.find((l) => l.url === url)
      return link ? link.files.map((f) => f.name).sort() : null
    }

    checkEqual(
      'the desk lists the link with both files at once',
      await filesOn(desk),
      [a.name, b.name].sort(),
    )

    await step('the desk adds the third file to the link the laptop made', () =>
      desk.cli('share', '--to', url, c.name),
    )
    await step('the laptop takes the first file off', () => laptop.cli('unshare', url, a.name))
    checkEqual(
      'the laptop lists the link with the second and third files at once',
      await filesOn(laptop),
      [b.name, c.name].sort(),
    )
    checkEqual(
      'the desk lists the link with the second and third files at once',
      await filesOn(desk),
      [b.name, c.name].sort(),
    )

    await step('laptop revokes the link', () => laptop.cli('revoke', url))
    checkEqual('the desk no longer lists the link', await filesOn(desk), null)
  },
})
