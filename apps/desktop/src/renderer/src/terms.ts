import { platformTerms } from '../../shared/platformTerms'

/** The words this window's copy uses for its platform. A test has no bridge and gets the Mac's. */
export const terms = platformTerms(
  typeof window === 'undefined' || !window.sia ? 'darwin' : window.sia.platform,
)
