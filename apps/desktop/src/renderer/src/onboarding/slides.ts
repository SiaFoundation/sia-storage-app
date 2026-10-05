/*
 * What the tour says, slide by slide, and the order it says it in.
 *
 * Three slides on what Sia Storage does with a file, then two on where the
 * files are. Every claim here is one the product makes of itself: files are
 * encrypted on the device before upload, each is split into 30 pieces of which
 * any 10 rebuild it, each piece goes to a different storage provider straight
 * from the device, and the indexer, which is the service, knows where pieces
 * are and not what they hold.
 */

export type SlideId = 'encrypt' | 'split' | 'distribute' | 'finder' | 'phone'

export type Slide = {
  id: SlideId
  title: string
  body: string
  /** The line under the picture, saying the one thing the picture is of. */
  caption: string
}

export function slides(finderName: string): Slide[] {
  return [
    {
      id: 'encrypt',
      title: 'Encrypted on this Mac',
      body: 'Every file is encrypted here, before anything is uploaded. The key comes from your recovery phrase, so nothing readable ever leaves your Mac.',
      caption: 'This is all anyone but you can see.',
    },
    {
      id: 'split',
      title: 'Split into 30 pieces',
      body: 'Each encrypted file is split into 30 pieces. Any 10 of them are enough to put it back together.',
      caption: 'A file can be recovered from any 10 of its pieces.',
    },
    {
      id: 'distribute',
      title: 'Sent straight to storage providers',
      body: 'Each piece goes straight from your Mac to a different independent storage provider. Providers only ever hold encrypted pieces, and the Sia Storage service only knows where they are, not what is in them.',
      caption: 'Up to 20 providers can be offline and the file is still there.',
    },
    {
      id: 'finder',
      title: 'Your files live in Finder',
      body: `Look for ${finderName} in the Finder sidebar. Open, move and rename files there like any others, and anything you add uploads on its own. The app stays in the menu bar.`,
      caption: 'A cloud marks a file that downloads when you open it.',
    },
    {
      id: 'phone',
      title: 'And on your phone',
      body: 'Sign in to the Sia Storage app on iPhone or Android with the same recovery phrase, and your library stays in sync on every device.',
      caption: 'The same folders, wherever you sign in.',
    },
  ]
}

/** The slide `step` away from `index`, held within the tour. */
export function moved(index: number, step: 1 | -1, count: number): number {
  return Math.min(count - 1, Math.max(0, index + step))
}
