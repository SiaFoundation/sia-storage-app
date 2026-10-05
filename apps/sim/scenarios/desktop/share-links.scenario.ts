import { defineScenario } from '../../src/scenario'

const LINK = /^https:\/\/share\.sia\.storage\/#share=([0-9a-f]{64})$/
const DAY_MS = 24 * 60 * 60 * 1000

export default defineScenario({
  name: "Finder's Share Link opens the Mac's share view, and the link follows its files as they change",
  description:
    "The laptop adds two files, and the Mac sends what Finder's Share Link action sends for them. The Mac's window opens on its share view listing both files, and a link made there with a one-day expiry is a share.sia.storage link whose key holds both files, shown under the folder the files are in. A second Share Link from Finder starts the view over for its own file, and a link made there to the file as it is now holds that one file. When the laptop renames one file and the Mac saves a new version of the other in Finder, recipients of the first link see the new name and the new version, still two files, and the second link keeps the version it was made with. Revoking both links in the window deletes both keys.",
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 10 * 60_000,
  async run({
    devices: { mac, laptop },
    network,
    seed,
    converge,
    step,
    check,
    checkEqual,
    waitFor,
    capture,
  }) {
    const window = mac.ui().window('main')
    // A link's mode is in its key's description, which the network keeps.
    const shareIn = async (description: string) =>
      (await network.shares()).find((s) => s.description === description)
    const latest = () => shareIn('Sia Storage')
    const sharedNames = async () =>
      ((await latest())?.objects ?? []).map((o) => String(o.metadata?.name)).sort()

    await step('the laptop adds two files', async () => {
      await seed('laptop', { count: 2, size: 16 * 1024 })
      await converge()
    })
    const names = (
      await mac.sql<{ name: string }>(
        `SELECT name FROM files WHERE kind = 'file' AND current = 1
           AND trashedAt IS NULL AND deletedAt IS NULL ORDER BY name`,
      )
    ).map((r) => r.name)
    checkEqual('the Mac holds both files', names.length, 2)
    const [first, second] = names

    await step("Finder's Share Link action is sent for both files", () => mac.finderShare(names))
    await step('the window opens on the share view with both files', async () => {
      await waitFor('the window to open', () => mac.ui().isShowing('main'))
      await window.waitFor({ text: first }, 30_000)
      await window.waitFor({ text: second })
    })
    await capture('share-new-link', ['mac'])

    const before = Date.now()
    await step('make a link that lasts one day', async () => {
      await window.tap({ text: '1 day' })
      await window.tap({ text: 'Create Link' })
      await window.waitFor({ id: 'share-url' }, 30_000)
    })
    await capture('share-link-created', ['mac'])
    const url = (await window.read({ id: 'share-url' })) ?? ''
    const seedHex = LINK.exec(url)?.[1]
    check('the link is a share.sia.storage link carrying the key', seedHex !== undefined)
    checkEqual(
      'the new link names the folder its files are in',
      await window.read({ id: 'share-folder' }),
      mac.identity.domainDisplay,
    )

    const [share] = await network.shares()
    checkEqual('the link is the key the network holds', share?.seed, seedHex)
    check(
      'the key expires a day after it was made',
      share?.expiresAt !== null &&
        share !== undefined &&
        Math.abs((share.expiresAt ?? 0) - (before + DAY_MS)) < 60_000,
    )
    checkEqual('recipients see both files', await sharedNames(), [first, second].sort())

    await step('a second Share Link from Finder replaces the link on screen', async () => {
      await mac.finderShare([second])
      await window.waitFor({ text: 'Create Link' }, 30_000)
      await window.waitFor({ id: 'share-file' })
    })
    checkEqual(
      'the view starts over with only the file asked for',
      await window.read({ id: 'share-file' }),
      second,
    )
    await step('make that one a link to the file as it is now', async () => {
      await window.tap({ text: 'These versions' })
      await window.tap({ text: 'Create Link' })
      await window.waitFor({ id: 'share-url' }, 30_000)
    })
    const snapshotOf = async () =>
      ((await shareIn('Sia Storage snapshot'))?.objects ?? []).map((o) => o.id)
    const snapshotAtFirst = await snapshotOf()
    checkEqual('the snapshot link holds the one file', snapshotAtFirst.length, 1)

    const [laptopFile] = await laptop.sql<{ id: string }>(
      'SELECT id FROM files WHERE name = ? AND current = 1',
      first,
    )
    await step('the laptop renames the first file', () =>
      laptop.call('files.renameFile', laptopFile.id, `renamed-${first}`),
    )
    await step('recipients see the new name', () =>
      waitFor(
        'the shared copy to carry the new name',
        async () => (await sharedNames()).includes(`renamed-${first}`),
        { timeoutMs: 60_000, intervalMs: 1000 },
      ),
    )

    const objectOf = async (name: string) =>
      (await latest())?.objects.find((o) => o.metadata?.name === name)?.id
    const oldVersion = await objectOf(second)
    await step('the Mac saves a new version of the second file in Finder', () =>
      mac.finderWrite(second, crypto.getRandomValues(new Uint8Array(24 * 1024))),
    )
    await step('recipients get the new version in place of the old', () =>
      waitFor(
        'the link to hold the new version',
        async () => {
          const now = await objectOf(second)
          return now !== undefined && now !== oldVersion
        },
        { timeoutMs: 60_000, intervalMs: 1000 },
      ),
    )
    checkEqual(
      'the link still holds two files',
      await sharedNames(),
      [`renamed-${first}`, second].sort(),
    )
    checkEqual(
      'the snapshot link still holds the version it was made with',
      await snapshotOf(),
      snapshotAtFirst,
    )

    await step('back to the status view, which counts the links', async () => {
      await window.tap({ text: 'Done' })
      await window.waitFor({ text: 'Share links' })
    })
    checkEqual('the status view counts two links', await window.read({ id: 'share-links' }), '2')

    await step('revoke both links from the list', async () => {
      await window.tap({ text: 'Share links' })
      await window.waitFor({ id: 'share-link' }, 30_000)
      await capture('share-links-list', ['mac'])
      for (let i = 0; i < 2; i++) {
        await window.tap({ text: 'Revoke' })
        await window.tap({ text: 'Revoke link' })
        await waitFor(
          'the link to leave the network',
          async () => (await network.shares()).length === 1 - i,
          {
            timeoutMs: 30_000,
            intervalMs: 500,
          },
        )
      }
      await window.waitFor({ id: 'share-links-empty' }, 30_000)
    })
    checkEqual('the network holds no key', (await network.shares()).length, 0)

    await step('the app dies and leaves its daemon running', () => mac.killApp())
    check(
      'the daemon still answers with the app gone',
      await mac.call('connection.getState').then(
        () => true,
        () => false,
      ),
    )
    await step("Finder's Share Link is sent with the app not running", () =>
      mac.finderShare([second]),
    )
    await step('the daemon opens the app on the share view for that file', async () => {
      await waitFor('the window to open', () => mac.ui().isShowing('main'), { timeoutMs: 60_000 })
      await window.waitFor({ id: 'share-file' }, 30_000)
    })
    checkEqual(
      'the reopened app shows the file Finder asked for',
      await window.read({ id: 'share-file' }),
      second,
    )
  },
})
