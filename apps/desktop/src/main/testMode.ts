/*
 * What a test build does differently when sim drives it.
 */

/**
 * Whether `url` is a page on the mock network a test build is pointed at,
 * such as the sign-in approval page. Those pages do not exist, so opening one
 * would put an error tab in front of whoever is at the Mac. Every other link,
 * a share link among them, opens as it would in any build.
 */
export function isMockNetworkPage(url: string, mockNetworkUrl: string | undefined): boolean {
  if (!mockNetworkUrl) return false
  try {
    return new URL(url).origin === new URL(mockNetworkUrl).origin
  } catch {
    return false
  }
}
