import { defineScenario } from '../../src/scenario'

const VISIBLE_FILES =
  "SELECT count(*) AS n FROM files WHERE kind = 'file' AND current = 1 AND trashedAt IS NULL AND deletedAt IS NULL"

export default defineScenario({
  name: "the Mac's popover and window show one status line, name metadata sync for what it is, and count files without thumbnails",
  description:
    "The laptop adds two images and a document, which gives the Mac's library thumbnails as well as files. The popover and the window count the files only. Open App in the popover opens the window on the same status with more rows. A file saved in Finder shows as a file being prepared or uploaded, and the Uploads row counts how many files are uploaded out of all of them, a sync-down shows as syncing encrypted metadata, and a rename waiting on the indexer shows as updating encrypted metadata, never as an upload. Each ends back at Up to date. A lost indexer connection is named in the status line of both, with its reason, and the popover has no separate rows for the indexer or the Finder folder.",
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 10 * 60_000,
  async run({
    devices: { mac, laptop },
    network,
    seed,
    seedTypes,
    converge,
    step,
    check,
    checkEqual,
    waitFor,
    capture,
  }) {
    const popover = mac.ui().window('popover')
    const window = mac.ui().window('main')
    const count = async (query: string) => (await mac.sql<{ n: number }>(query))[0].n
    const status = () => window.read({ id: 'status-message' })

    await step('the laptop adds two images and a document', async () => {
      await seedTypes('laptop', { types: ['png'], count: 2, names: 'plain' })
      await seed('laptop', { count: 1, size: 16 * 1024 })
      await converge()
    })
    await step("the images' thumbnails reach the Mac", () =>
      waitFor(
        'the Mac to hold thumbnails',
        async () => (await count("SELECT count(*) AS n FROM files WHERE kind = 'thumb'")) > 0,
        { timeoutMs: 60_000, intervalMs: 500 },
      ),
    )
    const files = await count(VISIBLE_FILES)
    checkEqual('the Mac holds the three files', files, 3)

    await step('open the popover', () => mac.openPopover())
    await step('the popover is up to date', () => popover.waitFor({ text: 'Up to date' }, 30_000))
    await capture('popover', ['mac'])
    checkEqual(
      'the popover counts files and leaves thumbnails out',
      await popover.read({ id: 'files' }),
      String(files),
    )
    checkEqual(
      'the popover shows activity, and has no rows for the indexer or the Finder folder',
      {
        uploads: await popover.read({ id: 'uploads' }),
        metadata: await popover.read({ id: 'metadata' }),
        indexer: await popover.read({ id: 'indexer' }),
        finder: await popover.read({ id: 'finder' }),
      },
      { uploads: 'All files uploaded', metadata: 'Up to date', indexer: null, finder: null },
    )

    await step('Open App in the popover opens the window', async () => {
      await popover.tap({ text: 'Open App' })
      await waitFor('the window to open', () => mac.ui().isShowing('main'))
      await window.waitFor({ text: 'Up to date' }, 30_000)
    })
    await capture('window', ['mac'])
    checkEqual(
      'the window shows the same count and the rows the popover has no room for',
      {
        files: await window.read({ id: 'files' }),
        folders: await window.read({ id: 'folders' }),
        uploads: await window.read({ id: 'uploads' }),
        metadata: await window.read({ id: 'metadata' }),
        connection: await window.read({ id: 'connection' }),
        finder: await window.read({ id: 'finder' }),
        finderName: await window.read({ id: 'finder-name' }),
      },
      {
        files: String(files),
        folders: '0',
        uploads: 'All files uploaded',
        metadata: 'Up to date',
        connection: 'Connected',
        finder: 'Mounted',
        finderName: mac.identity.domainDisplay,
      },
    )

    // Slow enough that the upload is still running when the status is read.
    await step('slow uploads', () => network.setConditions({ uploadBytesPerSec: 64 * 1024 }))
    await step('save a file in the Finder folder', () =>
      mac.finderWrite('report.bin', crypto.getRandomValues(new Uint8Array(512 * 1024))),
    )
    await step('the status line names the file in flight', () =>
      waitFor(
        'the status line to show the upload',
        async () => {
          const line = await status()
          return line && /^(Preparing|Uploading) 1 file$/.test(line) ? line : null
        },
        { timeoutMs: 60_000, intervalMs: 250 },
      ),
    )
    checkEqual(
      'the Uploads row counts the files already uploaded out of all of them',
      await window.read({ id: 'uploads' }),
      `${files} of ${files + 1}`,
    )
    await capture('uploading', ['mac'])
    await step('restore the upload rate', () => network.setConditions({ uploadBytesPerSec: 0 }))
    await step('everything converges', () => converge())
    await step('the status line returns to up to date', () =>
      window.waitFor({ text: 'Up to date' }, 60_000),
    )
    checkEqual('the saved file is counted', await window.read({ id: 'files' }), String(files + 1))
    checkEqual(
      'the Uploads row is back to everything uploaded',
      await window.read({ id: 'uploads' }),
      'All files uploaded',
    )

    // Held so the rename's metadata push is still waiting when the status is read.
    await step("hold the Mac's metadata reads", () =>
      network.hold({ op: 'getObject', device: 'mac' }),
    )
    await step('rename a file on the Mac', async () => {
      const [file] = await mac.sql<{ id: string }>("SELECT id FROM files WHERE name = 'report.bin'")
      await mac.call('files.renameFile', file.id, 'report-final.bin')
    })
    await step('the status line says metadata is being updated', () =>
      window.waitFor({ text: 'Updating encrypted metadata' }, 60_000),
    )
    await capture('updating-metadata', ['mac'])
    checkEqual(
      'no upload is listed while only metadata moves',
      await window.read({ id: 'uploads' }),
      'All files uploaded',
    )
    await step('release the hold', () => network.releaseHolds())
    await step('the status line returns to up to date', () =>
      window.waitFor({ text: 'Up to date' }, 60_000),
    )

    // Delayed so the Mac's sync-down is still fetching when the status is read.
    await step('slow the network', () => network.setConditions({ latencyMs: 2500 }))
    await step('the laptop adds two more files', () => seed('laptop', { count: 2, size: 8 * 1024 }))
    await step('the status line says metadata is syncing', () =>
      window.waitFor({ text: 'Syncing encrypted metadata' }, 120_000),
    )
    await capture('syncing-metadata', ['mac'])
    await step('restore the network', () => network.setConditions({ latencyMs: 0 }))
    await step('everything converges', () => converge())
    await step('the status line returns to up to date', () =>
      window.waitFor({ text: 'Up to date' }, 60_000),
    )
    checkEqual(
      'the window counts every file once more',
      await window.read({ id: 'files' }),
      String(await count(VISIBLE_FILES)),
    )

    // The test daemon never loses its connection on its own, so the state a
    // failed connection leaves is set directly. What is checked is how the app
    // shows it, in both places.
    await step('the indexer connection is lost', () =>
      mac.call('connection.setState', {
        isConnected: false,
        connectionError: 'Could not reach sia.storage',
      }),
    )
    await step('the status line names the indexer as the problem', () =>
      window.waitFor({ text: 'Indexer not connected' }, 30_000),
    )
    await capture('indexer-not-connected', ['mac'])
    checkEqual(
      'the reason is shown under it, in the window and in the popover',
      {
        window: await window.read({ id: 'status-detail' }),
        popover: await popover.read({ id: 'status-detail' }),
        popoverLine: await popover.read({ id: 'status-message' }),
      },
      {
        window: 'Could not reach sia.storage',
        popover: 'Could not reach sia.storage',
        popoverLine: 'Indexer not connected',
      },
    )
    await step('the connection comes back', async () => {
      await mac.call('connection.setState', { isConnected: true, connectionError: null })
      await window.waitFor({ text: 'Up to date' }, 30_000)
    })
  },
})
