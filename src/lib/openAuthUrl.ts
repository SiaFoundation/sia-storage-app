import { openInAppBrowser } from './inAppBrowser'

/**
 * Opens the auth URL in the in-app browser.
 * Waits for the user to complete authentication via the sia:// callback URL.
 * @param authURL - The auth URL to open.
 * @returns True if the auth URL was opened and the sia:// callback was received, false otherwise.
 */
export async function openAuthURL(authURL: string): Promise<boolean> {
  const result = await openInAppBrowser(authURL, {
    onResponseURL: (url) => url.startsWith('sia://'),
  })
  return result ?? false
}
