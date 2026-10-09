import { swrState } from '@siastorage/core/stores'

/** What the share link sheet opens on: files to make a new link for, or a link already made. */
type ShareLinkSheetTarget = { fileIds: string[] } | { publicKey: string }

type State = {
  /** Null while the sheet is closed. */
  target: ShareLinkSheetTarget | null
  /** Counts openings, so the sheet can tell a new opening from the one before. */
  opening: number
}

const store = swrState<State>({ target: null, opening: 0 })

export function openShareLinkSheet(target: ShareLinkSheetTarget): void {
  store.setState({ target, opening: store.getState().opening + 1 })
}

export function closeShareLinkSheet(): void {
  store.setState({ ...store.getState(), target: null })
}

export function useShareLinkSheet(): State {
  return store.useValue((s) => s, 'state')
}
