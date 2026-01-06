import { create } from 'zustand'

/**
 * State for the authentication WebView modal.
 *
 * This store manages a WKWebView-based authentication flow that can be automated
 * by E2E testing tools like Maestro (unlike SFSafariViewController which runs
 * in a separate process).
 */
type AuthWebViewState = {
  visible: boolean
  url: string
  resolver: ((value: string | null) => void) | null
  /** Opens the WebView and returns a promise that resolves with the callback URL or null if cancelled */
  open: (url: string) => Promise<string | null>
  /** Closes the WebView without completing auth (user cancelled) */
  close: () => void
  /** Called when auth completes successfully with the callback URL */
  callback: (callbackUrl: string) => void
}

export const useAuthWebViewStore = create<AuthWebViewState>((set, get) => ({
  visible: false,
  url: '',
  resolver: null,

  open: (url: string) => {
    // Return a promise that will be resolved when callback() or close() is called
    return new Promise((resolve) => {
      set({ visible: true, url, resolver: resolve })
    })
  },

  close: () => {
    // User cancelled - resolve with null
    const { resolver } = get()
    if (resolver) resolver(null)
    set({ visible: false, url: '', resolver: null })
  },

  callback: (callbackUrl: string) => {
    // Auth succeeded - resolve with the callback URL containing the token
    const { resolver } = get()
    if (resolver) resolver(callbackUrl)
    set({ visible: false, url: '', resolver: null })
  },
}))

/**
 * Opens the auth WebView modal and waits for completion.
 * Returns the callback URL on success, or null if the user cancelled.
 */
export const openAuthWebView = (url: string) =>
  useAuthWebViewStore.getState().open(url)
