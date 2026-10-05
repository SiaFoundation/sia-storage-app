import wordmark from './assets/sia-storage-dark.png'

/** The sia.storage wordmark that heads every view of the window. */
export function Wordmark() {
  return (
    // Drawn white with coloured accents for a dark background. Inverting it
    // alone would flip the accents too, so the hue is rotated back and only
    // the lightness changes.
    <img
      className="h-auto w-[132px] [@media(prefers-color-scheme:light)]:[filter:invert(1)_hue-rotate(180deg)]"
      src={wordmark}
      alt="sia.storage"
    />
  )
}
