import type { InspectedShare } from '@siastorage/mock-network/protocol'
import { defineScenario } from '../../src/scenario'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export default defineScenario({
  name: 'the phone makes share links from a file and from a selection, lists every link of the account and revokes one',
  description:
    "The phone imports two files and makes a one-day link to the first from its menu. The sheet shows a share.sia.storage link ending in the key the network holds, with that one file on it. With the laptop offline the phone renames the file, and recipients see the new name, so the phone moved its own link. The phone then selects both files and makes a link to them as they are now, which holds both. The laptop makes a third link, and the phone's list of links shows all three. Revoking the first from the list deletes its key and leaves the other two. Restarted with no network, the phone still shows a link's address.",
  devices: { phone: 'phone', laptop: 'cli' },
  timeoutMs: 15 * 60_000,
  async run({
    devices: { phone, laptop },
    network,
    seed,
    converge,
    step,
    check,
    checkEqual,
    waitFor,
    capture,
  }) {
    // A link's mode is in its key's description, which the network keeps.
    const sharesIn = async (description: string) =>
      (await network.shares()).filter((s) => s.description === description)
    const namesOn = (share: InspectedShare | undefined) =>
      (share?.objects ?? []).map((o) => String(o.metadata?.name)).sort()

    const [first, second] = await step('phone imports two files', () =>
      seed('phone', { count: 2, size: 16 * 1024, prefix: 'share' }),
    )
    await converge()

    let ui = phone.ui()
    await step("open the first file's menu and choose Share link", async () => {
      await ui.tap({ label: 'Files' })
      await ui.tap({ contains: 'No folder' })
      await ui.tap({ contains: first.name })
      await ui.tap({ label: 'More actions' })
      await ui.tap({ text: 'Share link' })
      await ui.waitFor({ text: 'Create Link' })
    })
    await capture('share-new-link', ['phone'])

    const before = Date.now()
    await step('make a link that lasts one day', async () => {
      await ui.tap({ label: '1 day' })
      await ui.tap({ text: 'Create Link' })
      await ui.waitFor({ id: 'share-link-url' }, 60_000)
    })
    const [made] = await network.shares()
    checkEqual('the network holds one key', (await network.shares()).length, 1)
    checkEqual('recipients see the one file', namesOn(made), [first.name])
    // The phone sets the expiry by its own clock, and an emulator restored
    // from a snapshot can run minutes off this machine's, so the check allows
    // an hour. The next choice up is a week.
    check(
      'the key expires a day after it was made',
      made?.expiresAt != null && Math.abs(made.expiresAt - (before + DAY_MS)) < HOUR_MS,
    )
    // The sheet shows the site and the end of the key, not the whole address.
    const keyEnd = made?.seed.slice(-8) ?? 'no key'
    check(
      'the sheet shows a share.sia.storage link ending in that key',
      await ui.isVisible({ contains: `share.sia.storage/…${keyEnd}` }),
    )
    await capture('share-link-made', ['phone'])
    // The button reads Copied for a second and a half, which is less than one
    // read of the screen can take, so the tap is all that is checked.
    await step('copy the link', () => ui.tap({ text: 'Copy Link' }))
    await step('close the sheet and the file', async () => {
      await ui.tap({ label: 'Done' })
      await ui.waitForGone({ id: 'share-link-url' })
      await ui.tap({ label: 'Close' })
    })

    // With the laptop offline only the phone can attach the renamed file again.
    const renamed = `renamed-${first.name}`
    await step('laptop goes offline', () => network.setOffline('laptop', true))
    await step('the phone renames the shared file', () =>
      phone.call('files.renameFile', first.id, renamed),
    )
    await step('recipients see the new name', () =>
      waitFor(
        'the shared copy to carry the new name',
        async () => namesOn((await sharesIn('Sia Storage'))[0]).includes(renamed),
        { timeoutMs: 60_000, intervalMs: 1000 },
      ),
    )
    await step('laptop reconnects', () => network.setOffline('laptop', false))

    await step('select both files and choose Share link', async () => {
      await ui.tap({ text: 'Select' })
      await ui.tap({ contains: renamed })
      await ui.tap({ contains: second.name })
      // The bar shows as many actions as fit and folds the rest under More.
      if (await ui.isVisible({ label: 'Share link' })) {
        await ui.tap({ label: 'Share link' })
      } else {
        await ui.tap({ label: 'More actions' })
        await ui.tap({ text: 'Share link' })
      }
      await ui.waitFor({ text: 'Create Link' })
    })
    check('the sheet names both files', await ui.isVisible({ text: '2 files' }))
    await step('make a link to the files as they are now', async () => {
      await ui.tap({ contains: 'These versions' })
      await ui.tap({ text: 'Create Link' })
      await ui.waitFor({ id: 'share-link-url' }, 60_000)
    })
    checkEqual(
      'the snapshot link holds both files',
      namesOn((await sharesIn('Sia Storage snapshot'))[0]),
      [renamed, second.name].sort(),
    )
    await step('close the sheet and leave selection mode', async () => {
      await ui.tap({ label: 'Done' })
      await ui.waitForGone({ id: 'share-link-url' })
      await ui.tap({ label: 'Exit selection mode' })
      await ui.tap({ label: 'Back' })
      await ui.waitFor({ label: 'Menu' })
    })

    await converge()
    const [onLaptop] = await laptop.sql<{ id: string }>(
      'SELECT id FROM files WHERE name = ? AND current = 1',
      second.name,
    )
    await step('the laptop makes a link to the second file', () =>
      laptop.call('shares.createLink', [onLaptop.id], { expiresAt: null, mode: 'latest' }),
    )
    checkEqual('the network holds three keys', (await network.shares()).length, 3)

    await step("the phone's list shows the laptop's link beside its own two", async () => {
      await ui.tap({ label: 'Menu' })
      await ui.tap({ label: 'Share Links' })
      await ui.waitFor({ contains: `${second.name}, Latest versions` }, 60_000)
      await ui.waitFor({ contains: `${renamed}, Latest versions` })
      await ui.waitFor({ contains: 'and 1 more' })
    })
    await capture('share-links-list', ['phone'])

    await step('revoke the first link from the list', async () => {
      await ui.tap({ contains: `${renamed}, Latest versions` })
      await ui.waitFor({ id: 'share-link-url' })
      await ui.tap({ label: 'Revoke Link' })
      await ui.tap({ text: 'Revoke' })
      await waitFor(
        'the key to leave the network',
        async () => (await network.shares()).length === 2,
        {
          timeoutMs: 30_000,
          intervalMs: 500,
        },
      )
      await ui.waitForGone({ id: 'share-link-url' })
      await ui.waitForGone({ contains: `${renamed}, Latest versions` })
    })
    checkEqual(
      'the two links left are the snapshot and the laptop’s',
      (await network.shares()).map((s) => namesOn(s).join(',')).sort(),
      [[renamed, second.name].sort().join(','), second.name].sort(),
    )

    // The address comes from the link's own row, so it needs no listing of the
    // account's keys, which a phone with no network cannot make.
    const [snapshot] = await sharesIn('Sia Storage snapshot')
    const snapshotEnd = snapshot?.seed.slice(-8) ?? 'no key'
    await step('restart the phone with no network', async () => {
      await ui.close()
      await network.setOffline('phone', true)
      await phone.stop()
      await phone.start()
      ui = phone.ui()
    })
    await step('open the snapshot link from the list, which shows its address', async () => {
      await ui.tap({ label: 'Menu' })
      await ui.tap({ label: 'Share Links' })
      await ui.tap({ contains: 'and 1 more' })
      await ui.waitFor({ contains: `share.sia.storage/…${snapshotEnd}` })
    })
    await ui.close()
  },
})
