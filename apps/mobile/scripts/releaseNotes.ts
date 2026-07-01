/**
 * Release-notes link for an internal build's "What to Test" / "What's new".
 *
 * knope publishes a GitHub Release per `mobile/v<version>` tag with the
 * version's changelog as the body. CI links to it instead of summarizing the
 * changelog, and the short link keeps Android under Play's 500-char limit.
 */

const REPO_SLUG = 'SiaFoundation/sia-storage-app'

function releaseNotesUrl(version: string): string {
  return `https://github.com/${REPO_SLUG}/releases/tag/mobile/v${version}`
}

export function whatsNewText(version: string): string {
  return `Read what's new in ${version}:\n${releaseNotesUrl(version)}`
}
