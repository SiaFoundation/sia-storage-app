import { defineScenario } from '../../src/scenario'

const LINK = /^https:\/\/share\.sia\.storage\/#share=([0-9a-f]{64})$/
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export default defineScenario({
  name: "the popover's activity tab lists the newest files with their upload state, and makes a share link for one in a click",
  description:
    "The laptop adds two files and the Mac then saves one in Finder. The popover's Activity tab lists the Mac's file first, and once the file is uploaded the row says only when it was added. Its share options make a link to the latest version that lasts a week, which is what the network holds and what the clipboard has. Choosing this version and no expiry there makes the next link that way, and the share button on another file then makes a link with those same settings in one click. An empty file the Mac then saves reads Unavailable in the open list once the uploader gives up on it.",
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 10 * 60_000,
  async run({
    devices: { mac },
    network,
    seed,
    converge,
    step,
    check,
    checkEqual,
    waitFor,
    capture,
  }) {
    const popover = mac.ui().window('popover')
    const clipboard = () => Bun.spawnSync(['pbpaste']).stdout.toString().trim()
    const shareWith = async (seedHex: string | undefined) =>
      (await network.shares()).find((s) => s.seed === seedHex)

    await step('the laptop adds two files', async () => {
      await seed('laptop', { count: 2, size: 16 * 1024 })
      await converge()
    })
    await step('the Mac saves a file in Finder', async () => {
      await mac.finderWrite('report.txt', crypto.getRandomValues(new Uint8Array(24 * 1024)))
      // The write returns once the bytes are on disk, before the extension has
      // handed the file to the daemon, and the laptop's rows would fill the list.
      await waitFor(
        'the Mac to add report.txt to its library',
        async () =>
          (await mac.sql(`SELECT 1 FROM files WHERE name = 'report.txt' AND current = 1`)).length >
          0,
        { timeoutMs: 30_000, intervalMs: 250 },
      )
    })
    const [older] = await mac.sql<{ name: string }>(
      `SELECT name FROM files WHERE kind = 'file' AND current = 1 AND trashedAt IS NULL
         AND deletedAt IS NULL AND name != 'report.txt' ORDER BY addedAt DESC LIMIT 1`,
    )

    await step('open the Activity tab', async () => {
      await mac.openPopover()
      await popover.tap({ text: 'Activity' })
      await popover.waitFor({ id: 'activity-file' }, 30_000)
    })
    checkEqual(
      'the file the Mac saved last is listed first',
      await popover.read({ id: 'activity-file' }),
      'report.txt',
    )
    await step('the file is uploaded', () =>
      waitFor(
        'the first row to say only when the file was added, once it is uploaded',
        async () => (await popover.read({ id: 'activity-status' }))?.startsWith('Added') === true,
        { timeoutMs: 60_000, intervalMs: 500 },
      ),
    )
    await capture('popover-activity', ['mac'])

    await step('make a link to the latest version that lasts a week', async () => {
      await popover.tap({ label: 'Share link options for report.txt' })
      await popover.tap({ text: 'Latest version' })
      await popover.tap({ text: '1 week' })
      await capture('popover-share-options', ['mac'])
      await popover.tap({ text: 'Copy Link' })
      await popover.waitFor({ text: 'Link copied' }, 30_000)
    })
    const weekLink = LINK.exec(clipboard())?.[1]
    check('the clipboard has a share.sia.storage link', weekLink !== undefined)
    const week = await shareWith(weekLink)
    checkEqual(
      'the network holds that link for the one file, following its latest version',
      { description: week?.description, names: week?.objects.map((o) => o.metadata?.name) },
      { description: 'Sia Storage', names: ['report.txt'] },
    )
    check(
      'the link expires a week after it was made',
      week?.expiresAt != null && Math.abs(week.expiresAt - (Date.now() + WEEK_MS)) < 120_000,
    )

    await step('choose this version and no expiry, and make that link', async () => {
      await popover.waitForGone({ text: 'Link copied' }, 10_000)
      await popover.tap({ label: 'Share link options for report.txt' })
      await popover.tap({ text: 'This version' })
      await popover.tap({ text: 'Never' })
      await popover.tap({ text: 'Copy Link' })
      await popover.waitFor({ text: 'Link copied' }, 30_000)
    })
    const keptLink = LINK.exec(clipboard())?.[1]
    const kept = await shareWith(keptLink)
    checkEqual(
      'that link holds the file as it is now and never expires',
      { description: kept?.description, expiresAt: kept?.expiresAt },
      { description: 'Sia Storage snapshot', expiresAt: null },
    )

    await step("one click on the other file's share button", async () => {
      await popover.waitForGone({ text: 'Link copied' }, 10_000)
      await popover.tap({ label: `Copy a share link for ${older.name}` })
      await popover.waitFor({ text: 'Link copied' }, 30_000)
    })
    const quickLink = LINK.exec(clipboard())?.[1]
    const quick = await shareWith(quickLink)
    checkEqual(
      'the one-click link uses the settings chosen last',
      {
        description: quick?.description,
        expiresAt: quick?.expiresAt,
        names: quick?.objects.map((o) => o.metadata?.name),
      },
      { description: 'Sia Storage snapshot', expiresAt: null, names: [older.name] },
    )
    checkEqual('the network holds the three links', (await network.shares()).length, 3)

    // The uploader marks an empty file lost with a plain file update, which
    // clears no cache the list reads, so only the library change signal
    // brings the open row up to date.
    await step('the Mac saves an empty file in Finder', async () => {
      await mac.finderWrite('empty.txt', new Uint8Array(0))
      await waitFor(
        'the empty file to lead the list',
        async () => (await popover.read({ id: 'activity-file' })) === 'empty.txt',
        { timeoutMs: 30_000, intervalMs: 250 },
      )
    })
    await step('its row says it is unavailable once the uploader gives it up', () =>
      waitFor(
        'the first row to read Unavailable',
        async () => (await popover.read({ id: 'activity-status' })) === 'Unavailable',
        { timeoutMs: 60_000, intervalMs: 500 },
      ),
    )
    // A file that can never upload would keep the devices from agreeing, and
    // that check counts trashed files, so this one is deleted for good.
    await step('delete the empty file', async () => {
      const [empty] = await mac.sql<{ id: string }>(
        `SELECT id FROM files WHERE name = 'empty.txt' AND current = 1`,
      )
      await mac.call('files.tombstoneFile', empty.id)
    })
  },
})
