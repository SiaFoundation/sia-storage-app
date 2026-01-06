import { openAuthWebView } from '../stores/authWebView'

/**
 * Opens the auth URL in the in-app WebView modal.
 * Returns true if auth succeeded (sia:// callback received), false otherwise.
 */
export async function openAuthURL(authURL: string): Promise<boolean> {
  const callbackUrl = await openAuthWebView(authURL)
  return callbackUrl !== null && callbackUrl.startsWith('sia://')
}
